export type ConfigMeta = {
  alias: string;
  desc: string;
  options?: { label: string; value: string }[];
  type?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
};

export const knownConfigs: Record<string, ConfigMeta> = {
  gxResolution: {
    alias: 'Resolution',
    desc: 'Screen resolution (Width x Height).',
    options: [
      { label: '3840x2160', value: '3840x2160' },
      { label: '2560x1440', value: '2560x1440' },
      { label: '1920x1080', value: '1920x1080' },
      { label: '1600x900', value: '1600x900' },
      { label: '1366x768', value: '1366x768' },
      { label: '1280x720', value: '1280x720' },
      { label: '960x540', value: '960x540' },
    ],
  },
  gxWindow: {
    alias: 'Window Mode',
    desc: 'Run the game in windowed or fullscreen mode.',
    options: [
      { label: 'Windowed', value: '1' },
      { label: 'Fullscreen', value: '0' },
    ],
  },
  gxMaximize: {
    alias: 'Maximize Window',
    desc: 'Maximizes the window; creates borderless windowed mode when used with gxWindow "1".',
    options: [
      { label: 'Off', value: '0' },
      { label: 'On', value: '1' },
    ],
  },
  gxFixLag: {
    alias: 'Hardware Cursor Lag Fix',
    desc: 'Reduces mouse cursor latency by using the hardware cursor path.',
    options: [
      { label: 'Off', value: '0' },
      { label: 'On', value: '1' },
    ],
  },
  projectedTextures: {
    alias: 'Projected Textures',
    desc: 'Projects spell and special effect textures onto terrain; important for raid spell visibility.',
    options: [
      { label: 'Off', value: '0' },
      { label: 'On', value: '1' },
    ],
  },
  videoOptionsVersion: {
    alias: 'Video Options Version',
    desc: 'Internal tracker for the graphics menu option profile version. Defaults to 3 for WotLK clients.',
    type: 'number',
  },
  maxFPS: {
    alias: 'Max FPS',
    desc: 'Maximum foreground frame rate cap. Use 0 for uncapped, or target values such as 60, 120, 144.',
    type: 'number',
    min: 0,
    max: 240,
    step: 1,
  },
  maxFPSbk: {
    alias: 'Max Background FPS',
    desc: 'Maximum frame rate cap when the game is running in the background. Common values are 1 to 60.',
    type: 'number',
    min: 1,
    max: 60,
    step: 1,
  },
  gxRefresh: {
    alias: 'Refresh Rate',
    desc: 'Monitor refresh rate in Hertz. Common values are 60, 75, 144, 240.',
    options: [
      { label: '60 Hz', value: '60' },
      { label: '75 Hz', value: '75' },
      { label: '144 Hz', value: '144' },
      { label: '240 Hz', value: '240' },
    ],
  },
  gxColorBits: {
    alias: 'Color Depth',
    desc: 'Color depth in bits for the display.',
    options: [
      { label: '16 bit', value: '16' },
      { label: '24 bit', value: '24' },
      { label: '32 bit', value: '32' },
    ],
  },
  gxDepthBits: {
    alias: 'Depth Buffer',
    desc: 'Depth buffer precision used by the renderer.',
    options: [
      { label: '16 bit', value: '16' },
      { label: '24 bit', value: '24' },
    ],
  },
  gxTripleBuffer: {
    alias: 'Triple Buffering',
    desc: 'Enable triple buffering for smoother frame pacing.',
    options: [
      { label: 'Off', value: '0' },
      { label: 'On', value: '1' },
    ],
  },
  gxMultisample: {
    alias: 'MSAA Level',
    desc: 'Multi-sample anti-aliasing quality level.',
    options: [
      { label: 'Off (1)', value: '1' },
      { label: '2x', value: '2' },
      { label: '4x', value: '4' },
      { label: '8x', value: '8' },
    ],
  },
  gxMultisampleQuality: {
    alias: 'MSAA Quality',
    desc: 'MSAA quality pass level used by the renderer.',
    options: [
      { label: 'Low', value: '0.000000' },
      { label: 'High', value: '1.000000' },
    ],
  },
  trilinear: {
    alias: 'Trilinear Filtering',
    desc: 'Enables trilinear texture filtering for smoother textures.',
    options: [
      { label: 'Off', value: '0' },
      { label: 'On', value: '1' },
    ],
  },
  anisotropic: {
    alias: 'Anisotropic Filtering',
    desc: 'Anisotropic texture filtering quality level.',
    options: [
      { label: 'Off (1)', value: '1' },
      { label: '2x', value: '2' },
      { label: '4x', value: '4' },
      { label: '8x', value: '8' },
      { label: '16x', value: '16' },
    ],
  },
  pixelShaders: {
    alias: 'Pixel Shaders',
    desc: 'Enable pixel shader rendering for visual effects.',
    options: [
      { label: 'Off', value: '0' },
      { label: 'On', value: '1' },
    ],
  },
  M2UsePixelShaders: {
    alias: 'Model Pixel Shaders',
    desc: 'Enable pixel shaders for 3D model rendering.',
    options: [
      { label: 'Off', value: '0' },
      { label: 'On', value: '1' },
    ],
  },
  shadowLevel: {
    alias: 'Shadow Quality',
    desc: 'Quality level of shadows.',
    options: [
      { label: 'Off', value: '0' },
      { label: 'Quality 1', value: '1' },
      { label: 'Quality 2', value: '2' },
      { label: 'Quality 3', value: '3' },
    ],
  },
  extShadowQuality: {
    alias: 'Extended Shadow Quality',
    desc: 'WotLK extended shadow quality level.',
    options: [
      { label: '0', value: '0' },
      { label: '1', value: '1' },
      { label: '2', value: '2' },
      { label: '3', value: '3' },
      { label: '4', value: '4' },
      { label: '5', value: '5' },
    ],
  },
  environmentDetail: {
    alias: 'Environment Detail',
    desc: 'Render detail distance for non-terrain objects and decorative doodads.',
    type: 'number',
    min: 50,
    max: 150,
    step: 1,
  },
  farClip: {
    alias: 'View Distance',
    desc: 'Maximum terrain rendering distance.',
    type: 'number',
    min: 177,
    max: 1277,
    step: 1,
  },
  groundEffectDensity: {
    alias: 'Ground Effect Density',
    desc: 'Density of ground clutter like grass and small foliage.',
    type: 'number',
    min: 0,
    max: 256,
    step: 1,
  },
  DistCull: {
    alias: 'Object Cull Distance',
    desc: 'Distance cutoff threshold for 3D objects. This is usually a decimal value.',
    type: 'number',
  },
  specular: {
    alias: 'Specular Effects',
    desc: 'Enable specular lighting and reflections.',
    options: [
      { label: 'Off', value: '0' },
      { label: 'On', value: '1' },
    ],
  },
  Gamma: {
    alias: 'Brightness',
    desc: 'Game brightness gamma level.',
    type: 'number',
    min: 0.5,
    max: 1.5,
    step: 0.01,
  },
  DesktopGamma: {
    alias: 'Desktop Gamma',
    desc: 'Forces the game to use the operating system gamma settings instead of in-game gamma.',
    options: [
      { label: 'Off', value: '0' },
      { label: 'On', value: '1' },
    ],
  },
  hwDetect: {
    alias: 'Hardware Detect',
    desc: 'Triggers hardware detection on next launch. Use 0 to skip or 1 to rerun detection.',
    options: [
      { label: 'Skip', value: '0' },
      { label: 'Run', value: '1' },
    ],
  },
  SmallCull: {
    alias: 'Small Object Cull Size',
    desc: 'Scale threshold for culling small objects.',
    type: 'number',
    min: 0.01,
    max: 1,
    step: 0.01,
  },
  nearclip: {
    alias: 'Near Clip',
    desc: 'Minimum camera distance before objects are clipped.',
    type: 'number',
    min: 0.01,
    max: 1,
    step: 0.01,
  },
  lodDist: {
    alias: 'LOD Distance',
    desc: 'Level of detail swap distance.',
    type: 'number',
    min: 50,
    max: 250,
    step: 1,
  },
  texLodBias: {
    alias: 'Texture LOD Bias',
    desc: 'Texture sharpness bias.',
    type: 'number',
    min: -1,
    max: 1,
    step: 1,
  },
  frillDensity: {
    alias: 'Frill Density (Legacy)',
    desc: 'Legacy ground clutter density key. In WotLK, groundEffectDensity is used instead.',
    type: 'number',
    min: 0,
    max: 256,
    step: 1,
  },
  mapObjLightLOD: {
    alias: 'Map Object Light Detail',
    desc: 'Lighting detail level for map structures.',
    options: [
      { label: '0', value: '0' },
      { label: '1', value: '1' },
      { label: '2', value: '2' },
    ],
  },
  SkyCloudLOD: {
    alias: 'Sky/Cloud Detail',
    desc: 'Cloud rendering detail level.',
    options: [
      { label: 'Low', value: '0' },
      { label: 'High', value: '1' },
    ],
  },
  weatherDensity: {
    alias: 'Weather Density',
    desc: 'Intensity of weather effects such as rain, snow, and fog.',
    type: 'number',
    min: 0,
    max: 3,
    step: 1,
  },
  MasterVolume: {
    alias: 'Master Volume',
    desc: 'Overall game sound volume.',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
  },
  Sound_EnableAllSound: {
    alias: 'Enable All Sound',
    desc: 'Master toggle for all in-game audio output.',
    options: [
      { label: 'Off', value: '0' },
      { label: 'On', value: '1' },
    ],
  },
  Sound_OutputDriverName: {
    alias: 'Audio Output Device',
    desc: 'Specifies the active hardware audio output device by name.',
    type: 'text',
  },
  SoundVolume: {
    alias: 'Sound Volume',
    desc: 'Sound effects volume.',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
  },
  Sound_MusicVolume: {
    alias: 'Music Volume',
    desc: 'Background music volume.',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
  },
  Sound_AmbienceVolume: {
    alias: 'Ambience Volume',
    desc: 'Ambient environment sound volume.',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
  },
  MusicVolume: {
    alias: 'Music Volume (Legacy)',
    desc: 'Legacy music volume key.',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
  },
  AmbienceVolume: {
    alias: 'Ambience Volume (Legacy)',
    desc: 'Legacy ambient audio volume key.',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
  },
  EnableMusic: {
    alias: 'Enable Music',
    desc: 'Master toggle for background music.',
    options: [
      { label: 'Off', value: '0' },
      { label: 'On', value: '1' },
    ],
  },
  footstepBias: {
    alias: 'Footstep Volume Bias',
    desc: 'Footstep sound volume modifier.',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
  },
  EnableErrorSpeech: {
    alias: 'Error Speech',
    desc: 'Enable character error voice line sounds.',
    options: [
      { label: 'Off', value: '0' },
      { label: 'On', value: '1' },
    ],
  },
  CameraDistanceMax: {
    alias: 'Max Camera Distance',
    desc: 'Maximum camera zoom out distance.',
    type: 'number',
    min: 1,
    max: 50,
    step: 1,
  },
  cameraDistanceMaxFactor: {
    alias: 'Camera Distance Factor',
    desc: 'Multiplier for maximum camera distance.',
    type: 'number',
    min: 1,
    max: 5,
    step: 1,
  },
  cameraYawMoveSpeed: {
    alias: 'Camera Yaw Move Speed',
    desc: 'Horizontal camera rotation speed during movement.',
    type: 'number',
    min: 50,
    max: 300,
    step: 1,
  },
  cameraYawSmoothSpeed: {
    alias: 'Camera Yaw Smooth Speed',
    desc: 'Camera damping interpolation speed.',
    type: 'number',
    min: 50,
    max: 300,
    step: 1,
  },
  cameraSmoothStyle: {
    alias: 'Camera Smooth Style',
    desc: 'How the camera auto-adjusts to character movement.',
    options: [
      { label: 'Manual', value: '0' },
      { label: 'Style 1', value: '1' },
      { label: 'Style 2', value: '2' },
    ],
  },
  cameraView: {
    alias: 'Camera View',
    desc: 'Active camera preset index.',
    type: 'number',
    min: 1,
    max: 5,
    step: 1,
  },
  cameraDistanceC: {
    alias: 'Camera Distance Save',
    desc: 'Saved zoom distance coefficient for the current camera view.',
    type: 'number',
  },
  cameraPitchC: {
    alias: 'Camera Pitch Save',
    desc: 'Saved vertical camera angle for the current view.',
    type: 'number',
  },
  cameraYawC: {
    alias: 'Camera Yaw Save',
    desc: 'Saved horizontal camera angle for the current view.',
    type: 'number',
  },
  cameraCustomViewSmoothing: {
    alias: 'Custom Camera Smoothing',
    desc: 'Smooth transitions when swapping camera views.',
    options: [
      { label: 'Off', value: '0' },
      { label: 'On', value: '1' },
    ],
  },
  uiScale: {
    alias: 'UI Scale',
    desc: 'Display interface scale multiplier.',
    type: 'number',
    min: 0.64,
    max: 1,
    step: 0.01,
  },
  useUiScale: {
    alias: 'Use UI Scale',
    desc: 'Enable the custom UI scale value.',
    options: [
      { label: 'Off', value: '0' },
      { label: 'On', value: '1' },
    ],
  },
  mouseSpeed: {
    alias: 'Mouse Speed',
    desc: 'Mouse sensitivity multiplier.',
    type: 'number',
    min: 0.5,
    max: 2.5,
    step: 0.01,
  },
  autoSelfCast: {
    alias: 'Auto Self Cast',
    desc: 'Automatically cast beneficial spells on self if no target is selected.',
    options: [
      { label: 'Off', value: '0' },
      { label: 'On', value: '1' },
    ],
  },
  ChatBubblesParty: {
    alias: 'Party Chat Bubbles',
    desc: 'Show chat bubbles over party members.',
    options: [
      { label: 'Off', value: '0' },
      { label: 'On', value: '1' },
    ],
  },
  profanityFilter: {
    alias: 'Profanity Filter',
    desc: 'Replace profanity in chat with symbols.',
    options: [
      { label: 'Off', value: '0' },
      { label: 'On', value: '1' },
    ],
  },
  showToolsUI: {
    alias: 'Show Tools UI',
    desc: 'Toggles developer/debug UI tools layout.',
    options: [
      { label: 'Off', value: '0' },
      { label: 'On', value: '1' },
    ],
  },
  locale: {
    alias: 'Locale',
    desc: 'Client language and region setting (e.g. enUS, enGB, deDE).',
    type: 'text',
  },
  realmList: {
    alias: 'Realm List',
    desc: 'Login server address or private server endpoint.',
    type: 'text',
  },
  realmName: {
    alias: 'Realm Name',
    desc: 'Last connected realm/server name.',
    type: 'text',
  },
  accountName: {
    alias: 'Account Name',
    desc: 'Last used login account name.',
    type: 'text',
  },
  accounttype: {
    alias: 'Account Type',
    desc: 'Client expansion level active for the account.',
    options: [
      { label: 'Classic', value: 'CL' },
      { label: 'The Burning Crusade', value: 'BC' },
      { label: 'Wrath of the Lich King', value: 'LK' },
    ],
  },
  readTOS: {
    alias: 'Read Terms of Service',
    desc: 'Acknowledgment of the Terms of Service.',
    options: [
      { label: 'Unread', value: '0' },
      { label: 'Read', value: '1' },
    ],
  },
  readEULA: {
    alias: 'Read EULA',
    desc: 'Acknowledgment of the End User License Agreement.',
    options: [
      { label: 'Unread', value: '0' },
      { label: 'Read', value: '1' },
    ],
  },
  movie: {
    alias: 'Intro Movie',
    desc: 'Tracks whether the expansion intro cinematic is skipped or played.',
    options: [
      { label: 'Skip', value: '0' },
      { label: 'Play', value: '1' },
    ],
  },
  screenshotQuality: {
    alias: 'Screenshot Quality',
    desc: 'JPEG compression quality for in-game screenshots.',
    type: 'number',
    min: 1,
    max: 10,
    step: 1,
  },
  processAffinityMask: {
    alias: 'Process Affinity Mask',
    desc: 'CPU core allocation mask for the game process. Common values are 3, 15, or 255 for 2, 4, or 8 cores respectively.',
    options: [
      { label: '2 cores (3)', value: '3' },
      { label: '4 cores (15)', value: '15' },
      { label: '8 cores (255)', value: '255' },
    ],
  },
  timingMethod: {
    alias: 'Timing Method',
    desc: 'Engine timing method for performance timing. Valid values are 0, 1, or 2.',
    options: [
      { label: 'System Standard', value: '0' },
      { label: 'TSC Override', value: '1' },
      { label: 'GetTickCount Mode', value: '2' },
    ],
  },
  minimapZoom: { alias: 'Minimap Zoom', desc: 'Saved outdoor minimap zoom level.', type: 'number' },
  minimapInsideZoom: {
    alias: 'Indoor Minimap Zoom',
    desc: 'Saved indoor/city minimap zoom level.',
    type: 'number',
  },
  checkAddonVersion: {
    alias: 'Addon Compatibility Check',
    desc: 'Prevent loading addons made for older patches.',
    options: [
      { label: 'Load anyway', value: '0' },
      { label: 'Check', value: '1' },
    ],
  },
  scriptMemory: {
    alias: 'Script Memory Limit',
    desc: 'Addon memory allocation limit in KB. Use 0 for default/unlimited.',
    type: 'number',
  },
};

export function friendlyConfigName(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getConfigMetadata(name: string, fullKey: string): ConfigMeta {
  return (
    knownConfigs[name] ||
    knownConfigs[fullKey] || {
      alias: friendlyConfigName(name),
      desc: 'Configuration option from config.wtf.',
      type: 'text',
    }
  );
}
