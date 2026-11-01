// Plugin entry point. With no arguments it handles a Claude Code hook; otherwise it
// runs the bundled wudland CLI (used by the /wudland:link command).
// Must never fail loudly or hang an agent: every path ends in exit code 0 for hooks.
const args = process.argv.slice(2);
try {
  if (args.length === 0) {
    const { runHook } = await import('./lib/hook.mjs');
    await runHook('claude');
    process.exit(0);
  } else {
    const { main } = await import('./lib/cli.mjs');
    process.exitCode = (await main(args)) ?? 0;
  }
} catch (e) {
  if (args.length) { process.stderr.write(`wudland: ${e.message}\n`); process.exitCode = 1; }
  else process.exit(0);
}
