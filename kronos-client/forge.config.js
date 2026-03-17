module.exports = {
  packagerConfig: {
    name: 'Kronos Client',
    executableName: 'kronos-client',
    asar: true,
    icon: './assets/icon'
  },
  rebuildConfig: {},
  makers: [
    // Windows - Squirrel
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'KronosClient',
        setupExe: 'KronosClient-Setup.exe',
        setupIcon: './assets/icon.ico'
      }
    },
    // Windows - ZIP
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32', 'linux']
    },
    // Linux - DEB
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          name: 'kronos-client',
          productName: 'Kronos Client',
          genericName: 'Chat Client',
          description: 'Client de connexion au serveur Kronos Chat',
          categories: ['Network', 'Chat', 'InstantMessaging'],
          maintainer: 'Kronos Team',
          homepage: 'https://kronos.local'
        }
      }
    },
    // macOS - DMG
    {
      name: '@electron-forge/maker-dmg',
      config: {
        name: 'KronosClient',
        format: 'ULFO'
      }
    }
  ],
  plugins: []
};
