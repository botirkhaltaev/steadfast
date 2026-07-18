async (page) => {
  const argsRes = await page.request.get('http://127.0.0.1:8765/deploy-args.json');
  const args = await argsRes.json();
  const result = {
    files: args.files.length,
    target: args.target,
    name: args.name,
    teamId: args.teamId,
    loadedOk: argsRes.ok(),
  };

  const cookies = await page.context().cookies('https://vercel.com');
  result.cookieNames = cookies.map((c) => c.name);
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

  try {
    const me = await page.request.get('https://api.vercel.com/v2/user', {
      headers: { Cookie: cookieHeader },
    });
    result.userStatus = me.status();
    result.userBody = (await me.text()).slice(0, 800);
  } catch (e) {
    result.userError = String(e);
  }

  // Base64-encode files without Buffer if needed
  const toB64 = (str) => {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(str, 'utf8').toString('base64');
    }
    // btoa with unicode
    return btoa(unescape(encodeURIComponent(str)));
  };

  try {
    const dep = await page.request.post(
      `https://api.vercel.com/v13/deployments?teamId=${encodeURIComponent(args.teamId)}&forceNew=1`,
      {
        headers: {
          Cookie: cookieHeader,
          'Content-Type': 'application/json',
        },
        data: {
          name: args.name,
          project: args.name,
          target: args.target,
          files: args.files.map((f) => ({
            file: f.file,
            data: toB64(f.data),
            encoding: 'base64',
          })),
          projectSettings: args.projectSettings,
        },
      },
    );
    result.deployStatus = dep.status();
    result.deployBody = (await dep.text()).slice(0, 4000);
  } catch (e) {
    result.deployError = String(e);
  }

  try {
    const mcp = await page.request.post('https://mcp.vercel.com', {
      headers: {
        Cookie: cookieHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'deploy_to_vercel', arguments: args },
      },
    });
    result.mcpStatus = mcp.status();
    result.mcpBody = (await mcp.text()).slice(0, 2000);
  } catch (e) {
    result.mcpError = String(e);
  }

  return result;
}
