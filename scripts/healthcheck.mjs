try {
  await Promise.all([4200, 4201, 4202].map(async port => {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok || (await response.json()).status !== 'ok') throw new Error('Unhealthy service');
  }));
} catch {
  process.exitCode = 1;
}
