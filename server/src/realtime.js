// Server-sent events hub. Each signed-in browser tab holds one stream; the
// server pushes chat messages and notifications to the users they concern.
// SSE is enough here because clients only receive; they send via plain POSTs.

export function createHub() {
  const streams = new Map(); // userId -> Set<res>

  function subscribe(userId, res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    if (!streams.has(userId)) streams.set(userId, new Set());
    streams.get(userId).add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    res.on('close', () => {
      clearInterval(ping);
      const set = streams.get(userId);
      set?.delete(res);
      if (set && !set.size) streams.delete(userId);
    });
  }

  function send(userIds, event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const id of new Set(userIds)) {
      for (const res of streams.get(id) ?? []) res.write(payload);
    }
  }

  function closeAll() {
    for (const set of streams.values()) for (const res of set) res.end();
    streams.clear();
  }

  return { subscribe, send, closeAll };
}
