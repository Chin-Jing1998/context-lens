module.exports = {
  appId: 'io.github.Chin-Jing1998.context-lens', productName: 'Context Lens',
  directories: { output: 'desktop/build/windows' },
  extraMetadata: { main: 'desktop/windows/main.cjs', author: { name: 'Chin-Jing1998', url: 'https://github.com/Chin-Jing1998' } },
  files: ['dist/**/*', 'web/**/*', 'desktop/windows/**/*', 'desktop/assets/*', 'package.json', 'LICENSE', '!**/*.map', '!**/*.d.ts', '!desktop/windows/builder.cjs', '!desktop/windows/installer.nsh'],
  asar: true,
  win: { icon: 'desktop/assets/ContextLens.ico', target: [{ target: 'nsis', arch: ['x64'] }, { target: 'portable', arch: ['x64'] }], signAndEditExecutable: true },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true,
    artifactName: 'Context-Lens-${version}-win-${arch}-setup.${ext}', include: 'desktop/windows/installer.nsh', installerIcon: 'desktop/assets/ContextLens.ico', uninstallerIcon: 'desktop/assets/ContextLens.ico', },
  portable: { artifactName: 'Context-Lens-${version}-win-${arch}-portable.${ext}' },
  publish: null,
};
