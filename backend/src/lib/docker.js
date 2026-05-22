import fetch from 'node-fetch';

const PROXY_URL = process.env.DOCKER_SOCKET_PROXY_URL ?? 'http://socket-proxy:2375';

// Docker's exec stream uses an 8-byte multiplexing header per frame:
//   byte 0:   stream type (1=stdout, 2=stderr)
//   bytes 4-7: frame length (big-endian uint32)
function parseDockerStream(buffer) {
  let stdout = '';
  let stderr = '';
  let offset = 0;

  while (offset + 8 <= buffer.length) {
    const streamType = buffer[offset];
    const frameLen = buffer.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + frameLen > buffer.length) break;
    const chunk = buffer.slice(offset, offset + frameLen).toString('utf8');
    offset += frameLen;
    if (streamType === 1) stdout += chunk;
    else if (streamType === 2) stderr += chunk;
  }

  return { stdout, stderr };
}

async function exec(containerName, cmd) {
  // Step 1: create exec instance
  const createRes = await fetch(`${PROXY_URL}/containers/${containerName}/exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ AttachStdout: true, AttachStderr: true, Cmd: cmd }),
  });

  if (!createRes.ok) {
    throw new Error(`Docker exec create failed (${createRes.status}): ${await createRes.text()}`);
  }

  const { Id: execId } = await createRes.json();

  // Step 2: start exec and collect output
  const startRes = await fetch(`${PROXY_URL}/exec/${execId}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Detach: false, Tty: false }),
  });

  if (!startRes.ok) {
    throw new Error(`Docker exec start failed (${startRes.status}): ${await startRes.text()}`);
  }

  const buf = Buffer.from(await startRes.arrayBuffer());
  const { stdout, stderr } = parseDockerStream(buf);

  // Step 3: retrieve exit code
  const inspectRes = await fetch(`${PROXY_URL}/exec/${execId}/json`);
  const { ExitCode: exitCode } = await inspectRes.json();

  return { stdout, stderr, exitCode };
}

export async function nginxValidate(containerName) {
  const { stdout, stderr, exitCode } = await exec(containerName, ['nginx', '-t']);
  return {
    ok: exitCode === 0,
    output: (stdout + stderr).trim(),
    exitCode,
  };
}

export async function nginxReload(containerName) {
  const { stdout, stderr, exitCode } = await exec(containerName, ['nginx', '-s', 'reload']);
  return {
    ok: exitCode === 0,
    output: (stdout + stderr).trim(),
    exitCode,
  };
}
