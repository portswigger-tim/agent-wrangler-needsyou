// Delivering the human's answer back into the asking session's prompt
// (docs/specs/01-contracts.md §6). Through host.deliver, not mail: extension
// mail is framed as an untrusted peer inviting a reply to a non-session address.

// The exact text the agent receives. The skill teaches agents to recognise the
// `[Needs you]` prefix, so this format is a contract: change it in §6 first.
export function answerText(item) {
  const lines = [`[Needs you] The human answered your request "${item.title}" (${item.id}).`];
  const { optionId, text } = item.answer ?? {};
  if (optionId) {
    const option = item.options.find((o) => o.id === optionId);
    lines.push(`Choice: ${option ? option.label : optionId} (${optionId})`);
  }
  if (text) lines.push(`Note: ${text}`);
  return lines.join('\n');
}

// One delivery attempt for an `answered` item -> the item afterwards. A
// failure (a refusal, a throw, a result of the wrong shape) is recorded as
// `failed` with its error, never thrown: the human retries from the queue.
export async function deliverAnswer(host, store, id) {
  const item = store.get(id);
  if (!item) throw new Error('unknown inbox item');
  if (item.state !== 'answered') throw new Error(`this request is ${item.state}, not answered`);

  let result;
  try {
    result = await host.deliver(item.sessionId, answerText(item));
  } catch (err) {
    result = { mode: 'error', error: String(err?.message ?? err) };
  }

  // The item may have moved on while deliver was in flight (withdrawn, the
  // session archived); there is no attempt left to record then.
  if (store.get(id)?.state !== 'answered') return store.get(id);
  if (result?.mode === 'live' || result?.mode === 'dormant') return store.setDelivery(id, { delivery: 'delivered' });
  const error = result?.mode === 'error' ? result.error : 'host.deliver returned an unexpected result';
  return store.setDelivery(id, { delivery: 'failed', deliveryError: String(error || 'delivery failed') });
}
