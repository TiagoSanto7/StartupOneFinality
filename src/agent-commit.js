import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { requestRefund } from './client.js';

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function canonicalInput(input) {
  if (typeof input?.actionId !== 'string' || !input.actionId.trim()
    || !Number.isSafeInteger(input.amountCents) || input.amountCents <= 0
    || Object.keys(input).some(key => !['actionId', 'amountCents'].includes(key))) {
    throw failure('INVALID_INPUT', 'Expected actionId and positive integer amountCents only');
  }
  return { actionId: input.actionId, amountCents: input.amountCents };
}

// Local durable store. All writers must use this class and share the same directory.
export class AgentCommit {
  constructor({ directory, providerUrl, timeoutMs = 1000 }) {
    this.directory = directory;
    this.providerUrl = providerUrl;
    this.timeoutMs = timeoutMs;
    mkdirSync(directory, { recursive: true });
  }

  path(actionId) {
    if (typeof actionId !== 'string' || !actionId.trim()) throw failure('INVALID_INPUT', 'Missing actionId');
    return join(this.directory, createHash('sha256').update(actionId).digest('hex') + '.json');
  }

  get(actionId) {
    try { return JSON.parse(readFileSync(this.path(actionId), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  locked(actionId, fn) {
    const lock = this.path(actionId) + '.lock';
    try { mkdirSync(lock); }
    catch (error) {
      if (error.code === 'EEXIST') throw failure('ACTION_BUSY', 'Action store is locked; retry not authorized');
      throw error;
    }
    try { return fn(); } finally { rmSync(lock, { recursive: true }); }
  }

  save(record) {
    const target = this.path(record.actionId);
    const temporary = target + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', flush: true });
      renameSync(temporary, target);
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  transition(record, state) {
    record.state = state;
    record.history.push({ state, at: new Date().toISOString() });
    this.save(record);
  }

  assertMayAdvance(actionId) {
    const record = this.get(actionId);
    if (record?.state !== 'COMMITTED') {
      throw failure('CONTINUATION_BLOCKED', 'Action has no confirmed outcome; continuation blocked');
    }
    return record;
  }

  async execute(input) {
    const canonical = canonicalInput(input);
    const intent = { operation: 'refund', providerUrl: this.providerUrl, input: canonical };
    const record = this.locked(canonical.actionId, () => {
      let current = this.get(canonical.actionId);
      if (current && JSON.stringify(current.intent) !== JSON.stringify(intent)) {
        throw failure('INTENT_CONFLICT', 'Action identity already belongs to a different intent');
      }
      if (current?.state === 'COMMITTED') return current;
      if (current && current.state !== 'PREPARED') {
        throw failure('RETRY_BLOCKED', `Action ${current.effect_id} is ${current.state}; retry blocked`);
      }
      if (!current) {
        current = { effect_id: randomUUID(), actionId: canonical.actionId, intent, attempts: [], history: [] };
        this.transition(current, 'PREPARED');
      }
      current.attempts.push({ number: current.attempts.length + 1, dispatchedAt: new Date().toISOString() });
      // Persist before starting I/O. A crash here leaves DISPATCHED, which also blocks retries.
      this.transition(current, 'DISPATCHED');
      return current;
    });
    if (record.state === 'COMMITTED') return record;

    let receipt;
    try {
      receipt = await requestRefund(this.providerUrl, canonical, this.timeoutMs);
      if (receipt.actionId !== canonical.actionId || receipt.amountCents !== canonical.amountCents
        || typeof receipt.refundId !== 'string' || !receipt.refundId) {
        throw failure('INVALID_RECEIPT', 'Provider response does not confirm this refund');
      }
    } catch (error) {
      this.locked(canonical.actionId, () => {
        record.attempts.at(-1).error = { code: error.code ?? 'PROVIDER_ERROR', message: error.message };
        this.transition(record, 'UNKNOWN');
      });
      throw Object.assign(failure('OUTCOME_UNKNOWN', 'Dispatched refund outcome unknown; do not retry or advance'), {
        cause: error, effect_id: record.effect_id,
      });
    }
    return this.locked(canonical.actionId, () => {
      record.receipt = receipt;
      record.attempts.at(-1).confirmedAt = new Date().toISOString();
      this.transition(record, 'COMMITTED');
      return record;
    });
  }
}
