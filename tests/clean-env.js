// Preloaded into every test process (see the test scripts in package.json). The HUD and the git it
// runs read these from the environment, so a developer's own values would leak into tests that
// don't set them.
for (const name of Object.keys(process.env)) {
  if (/^(CLAUDE_|ANTHROPIC_|CONTEXT_LENS_|GIT_)/.test(name) || name === 'COLUMNS' || name === 'DEBUG') {
    delete process.env[name];
  }
}

// 测试使用临时 Git 仓库，不继承开发者的钩子或 Git 配置。
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
