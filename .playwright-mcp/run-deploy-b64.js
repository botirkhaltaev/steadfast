async (page) => {
  const argsRes = await page.request.get(
    'http://127.0.0.1:8765/deploy-args-b64.json',
  );
  const args = await argsRes.json();
  const result = {
    files: args.files.length,
    target: args.target,
    loadedOk: argsRes.ok(),
  };

  // Navigate to ensure we're on vercel domain for cookies
  // Use page.request which shares cookie jar

  const cookies = await page.context().cookies();
  result.cookieNames = cookies.map((c) => c.name);
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

  // Try deployment with pre-encoded base64 files
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
          files: args.files,
          projectSettings: args.projectSettings,
        },
      },
    );
    result.deployStatus = dep.status();
    result.deployBody = (await dep.text()).slice(0, 4000);
  } catch (e) {
    result.deployError = String(e);
  }

  return result;
}
