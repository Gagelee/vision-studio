import { ElementType, ShotType, Story, AspectRatio } from './types';

export const IMAGES = {
  // Characters
  KENJI: 'https://images.unsplash.com/photo-1535295972055-1c762f4483e5?q=80&w=1287&auto=format&fit=crop',
  KENJI_CASUAL: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=1287&auto=format&fit=crop',
  KENJI_RAIN: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?q=80&w=1448&auto=format&fit=crop',
  
  ANYA: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=1364&auto=format&fit=crop',
  ANYA_DISGUISE: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?q=80&w=1287&auto=format&fit=crop',
  ANYA_GALA: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?q=80&w=1364&auto=format&fit=crop',
  
  CHEF: 'https://images.unsplash.com/photo-1589254065878-42c9da997008?q=80&w=1400&auto=format&fit=crop',
  CHEF_DAMAGED: 'https://images.unsplash.com/photo-1589254066213-a0c9dc853511?q=80&w=1400&auto=format&fit=crop',
  
  KAITO: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?q=80&w=1287&auto=format&fit=crop',
  KAITO_ARMOR: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?q=80&w=1287&auto=format&fit=crop',

  ELARA: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?q=80&w=1287&auto=format&fit=crop',
  ELARA_TECH: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?q=80&w=1287&auto=format&fit=crop',

  VESPER: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?q=80&w=1287&auto=format&fit=crop',
  VESPER_PILOT: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?q=80&w=1287&auto=format&fit=crop',

  SILAS: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=1287&auto=format&fit=crop',
  SILAS_ARMOR: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?q=80&w=1287&auto=format&fit=crop',
  
  // Locations
  RAMEN_ALLEY: 'https://images.unsplash.com/photo-1555680202-c86f0e12f086?q=80&w=2070&auto=format&fit=crop',
  APARTMENT: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=2070&auto=format&fit=crop',
  SKYBRIDGE: 'https://images.unsplash.com/photo-1449156059431-789955fa190a?q=80&w=2070&auto=format&fit=crop',
  DOCK: 'https://images.unsplash.com/photo-1516939884455-1445c8652f83?q=80&w=2070&auto=format&fit=crop',
  LAB: 'https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=2070&auto=format&fit=crop',
  ROOFTOP: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?q=80&w=2070&auto=format&fit=crop',
  CLUB: 'https://images.unsplash.com/photo-1566737236500-c8ac43014a67?q=80&w=2070&auto=format&fit=crop',
  BOARDROOM: 'https://images.unsplash.com/photo-1497366216548-37526070297c?q=80&w=2070&auto=format&fit=crop',
  
  // Shots
  SHOT_WIDE: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=2025&auto=format&fit=crop',
  SHOT_MEDIUM: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?q=80&w=2070&auto=format&fit=crop',
  SHOT_ACTION: 'https://images.unsplash.com/photo-1478720568477-152d9b164e26?q=80&w=2070&auto=format&fit=crop',
  SHOT_LAB: 'https://images.unsplash.com/photo-1532187863486-abf9d39d99c5?q=80&w=1470&auto=format&fit=crop',
};

const MOCK_CHARACTERS = [
  { 
    id: 'char-kenji', 
    name: 'Kenji Sato', 
    description: 'Retired android detective. Face mapped with deep lines and rain-slicked stubble.',
    avatarUrl: IMAGES.KENJI,
    status: 'locked' as const,
    looks: [
      { id: 'look-kenji-1', name: 'Tactical Coat', description: 'Black high-collar trench coat, glowing synthetic eye.', previewUrl: IMAGES.KENJI },
      { id: 'look-kenji-2', name: 'Undercover Noir', description: 'Grey undershirt, loosened tie, looking tired.', previewUrl: IMAGES.KENJI_CASUAL },
      { id: 'look-kenji-3', name: 'Rain Drenched', description: 'Heavily wet hair, translucent plastic poncho over suit.', previewUrl: IMAGES.KENJI_RAIN }
    ]
  },
  { 
    id: 'char-anya', 
    name: 'Anya Corvus', 
    description: 'Corporate Fixer. Sharp angular bob cut, jet black.',
    avatarUrl: IMAGES.ANYA,
    status: 'draft' as const,
    looks: [
      { id: 'look-anya-1', name: 'Executive Suit', description: 'Structured black suit with fiber-optic pinstripes.', previewUrl: IMAGES.ANYA },
      { id: 'look-anya-2', name: 'Market Disguise', description: 'Neon-mesh hoodie and heavy combat boots.', previewUrl: IMAGES.ANYA_DISGUISE },
      { id: 'look-anya-3', name: 'Gala Evening', description: 'Sleek silver backless dress with neural-link jewelry.', previewUrl: IMAGES.ANYA_GALA }
    ]
  },
  { 
    id: 'char-kaito', 
    name: 'Kaito Vane', 
    description: 'Rogue technomancer with cybernetic arm. Energetic and dangerous.',
    avatarUrl: IMAGES.KAITO,
    status: 'draft' as const,
    looks: [
      { id: 'look-kaito-1', name: 'Streetwear', description: 'Oversized bomber jacket, tech-wear joggers.', previewUrl: IMAGES.KAITO },
      { id: 'look-kaito-2', name: 'Combat Armor', description: 'Modular ceramic plating, full-face visor.', previewUrl: IMAGES.KAITO_ARMOR }
    ]
  },
  { 
    id: 'char-elara', 
    name: 'Dr. Elara Thorne', 
    description: 'Lead scientist at Bio-Core. Calculating and sophisticated.',
    avatarUrl: IMAGES.ELARA,
    status: 'locked' as const,
    looks: [
      { id: 'look-elara-1', name: 'Lab White', description: 'Sterile white lab coat, data-pad in hand.', previewUrl: IMAGES.ELARA },
      { id: 'look-elara-2', name: 'Field Tech', description: 'High-visibility utility vest with scanning equipment.', previewUrl: IMAGES.ELARA_TECH }
    ]
  },
  { 
    id: 'char-chef', 
    name: 'Unit 734 (Chef)', 
    description: 'Industrial Droid. Ceramic plating chipped to reveal copper wiring.',
    avatarUrl: IMAGES.CHEF,
    status: 'draft' as const,
    looks: [
      { id: 'look-chef-1', name: 'Kitchen Service', description: 'Stained apron, yellow optics active.', previewUrl: IMAGES.CHEF },
      { id: 'look-chef-2', name: 'Combat Protocol', description: 'Red optics, heavy plating exposed, weaponized attachments.', previewUrl: IMAGES.CHEF_DAMAGED }
    ]
  },
  { 
    id: 'char-vesper', 
    name: 'Vesper Lin', 
    description: 'Smuggler pilot. Confident, wears aviator goggles always.',
    avatarUrl: IMAGES.VESPER,
    status: 'draft' as const,
    looks: [
      { id: 'look-vesper-1', name: 'Flight Suit', description: 'Worn leather jacket, orange flight jumpsuit pants.', previewUrl: IMAGES.VESPER_PILOT },
      { id: 'look-vesper-2', name: 'Night Club', description: 'Shimmering synth-silk shirt, dark glasses.', previewUrl: IMAGES.VESPER }
    ]
  },
  { 
    id: 'char-silas', 
    name: 'Director Silas', 
    description: 'Antagonist. Corporate CEO of Bio-Core. Cold and ruthless.',
    avatarUrl: IMAGES.SILAS,
    status: 'locked' as const,
    looks: [
      { id: 'look-silas-1', name: 'Boardroom', description: 'Immaculate charcoal suit, minimalist design.', previewUrl: IMAGES.SILAS },
      { id: 'look-silas-2', name: 'Exo-Frame', description: 'Wearing a powered exoskeleton over his suit.', previewUrl: IMAGES.SILAS_ARMOR }
    ]
  }
];

const MOCK_LOCATIONS = [
  {
    id: 'loc-alley',
    name: 'Neon Ramen Alley',
    description: 'Narrow street crowded with holographic ads. Steam rising from vents. Wet pavement reflecting neon pinks and blues.',
    visualStyle: 'Cyberpunk Noir, High Contrast, Wet Surfaces, Volumetric Fog.',
    previewUrl: IMAGES.RAMEN_ALLEY,
    status: 'locked' as const
  },
  {
    id: 'loc-apt',
    name: 'Kenji\'s Apartment',
    description: 'Small, cluttered living space. One window overlooking the mega-city. Blue ambient light from outside.',
    visualStyle: 'Claustrophobic, Cold Tones, Shadowy corners.',
    previewUrl: IMAGES.APARTMENT,
    status: 'draft' as const
  },
  {
    id: 'loc-club',
    name: 'The Void Club',
    description: 'Underground techno club. Strobe lights, dense crowd, laser grids.',
    visualStyle: 'Chaotic lighting, Deep reds and purples, Motion blur.',
    previewUrl: IMAGES.CLUB,
    status: 'draft' as const
  },
  {
    id: 'loc-lab',
    name: 'Bio-Core Laboratory',
    description: 'Sterile white environment. Glass walls, advanced robotics arms, cold fluorescent lighting.',
    visualStyle: 'Clinical, Bright High-Key, Anamorphic lens flares.',
    previewUrl: IMAGES.LAB,
    status: 'locked' as const
  },
  {
    id: 'loc-bridge',
    name: 'Sector 7 Skybridge',
    description: 'Suspended walkway between skyscrapers. Heavy wind, rain, panoramic view of the city below.',
    visualStyle: 'Epic scale, Wide shots, Atmospheric perspective.',
    previewUrl: IMAGES.SKYBRIDGE,
    status: 'draft' as const
  },
  {
    id: 'loc-board',
    name: 'Executive Boardroom',
    description: 'Top floor of the Bio-Core tower. Floor to ceiling windows, minimalist furniture.',
    visualStyle: 'Symmetrical, Cold, Golden Hour lighting from sunset.',
    previewUrl: IMAGES.BOARDROOM,
    status: 'locked' as const
  }
];

const createShot = (id: string, seq: number, locId: string, time: string, desc: string, duration: number, thumb: string, chars: any[] = []): any => ({
  id,
  sequence: seq,
  locationId: locId,
  timeOfDay: time,
  description: desc,
  duration,
  thumbnailUrl: thumb,
  activeVersionId: 'v1',
  versions: [{ id: 'v1', imageUrl: thumb, createdAt: Date.now(), type: 'base' }],
  elements: {
    [ElementType.SCRIPT]: { type: ElementType.SCRIPT, prompt: '', status: 'auto' },
    [ElementType.CASTING]: { type: ElementType.CASTING, prompt: '', status: 'manual', metadata: { characters: chars } },
    [ElementType.CAMERA]: { type: ElementType.CAMERA, prompt: 'Cinematic wide shot', status: 'auto' },
    [ElementType.LIGHTING]: { type: ElementType.LIGHTING, prompt: 'Ambient neon', status: 'auto' },
    [ElementType.AUDIO]: { type: ElementType.AUDIO, prompt: 'City ambience', status: 'auto' }
  },
  aiState: 'idle'
});

const createSequenceWithScene = (id: string, title: string, context: string, sceneTitle: string, shots: any[]) => ({
  id,
  title,
  context,
  scenes: [
    {
      id: `${id}-scene-1`,
      title: sceneTitle,
      shots,
    },
  ],
  shots,
});

export const INITIAL_STORY: Story = {
  id: 'proj-protocol-7',
  title: 'Neon Shadows: Protocol 7',
  logline: 'A retired android detective is pulled back into the underworld to solve the murder of a synthetic pop star, only to discover a conspiracy that threatens the core of human-AI coexistence.',
  intent: 'Create a gritty cyberpunk noir trailer focusing on mystery and atmosphere.',
  keyVisualUrl: IMAGES.SKYBRIDGE,
  aspectRatio: '16:9',
  status: 'ready',
  locations: MOCK_LOCATIONS,
  characters: MOCK_CHARACTERS,
  sequences: [
    createSequenceWithScene(
      'seq-1',
      'The Awakening',
      'Kenji is woken up by a disturbance in the alleyway below his apartment.',
      'Night Wake-Up',
      [
        createShot('shot-1-1', 1, 'loc-apt', 'Night', 'Close up on Kenji\'s face, eyes opening. The neon light from the window reflects in his synthetic iris.', 3, IMAGES.KENJI, [{ id: 'char-kenji', activeLookId: 'look-kenji-2' }]),
        createShot('shot-1-2', 2, 'loc-apt', 'Night', 'Kenji sits up on the edge of the bed. Silhouette against the bright window.', 4, IMAGES.APARTMENT, [{ id: 'char-kenji', activeLookId: 'look-kenji-2' }]),
        createShot('shot-1-3', 3, 'loc-alley', 'Night', 'POV from the window looking down at the rainy alley. A mysterious figure moves in the shadows.', 5, IMAGES.RAMEN_ALLEY, [])
      ],
    ),
    createSequenceWithScene(
      'seq-2',
      'Ramen Shop Meeting',
      'Kenji meets Anya to get intel on the new drug circulating the streets.',
      'Intel Exchange',
      [
        createShot('shot-2-1', 1, 'loc-alley', 'Night', 'Wide shot of the Ramen shop. Steam rising. Kenji walks into frame.', 6, IMAGES.SHOT_WIDE, [{ id: 'char-kenji', activeLookId: 'look-kenji-1' }]),
        createShot('shot-2-2', 2, 'loc-alley', 'Night', 'Over the shoulder shot. Anya is eating, not looking at Kenji.', 4, IMAGES.ANYA, [{ id: 'char-kenji', activeLookId: 'look-kenji-1' }, { id: 'char-anya', activeLookId: 'look-anya-2' }]),
        createShot('shot-2-3', 3, 'loc-alley', 'Night', 'Close up on Anya. She slides a data chip across the table.', 3, IMAGES.SHOT_MEDIUM, [{ id: 'char-anya', activeLookId: 'look-anya-2' }])
      ],
    ),
    createSequenceWithScene(
      'seq-3',
      'Infiltration',
      'Kenji and Kaito break into the Bio-Core facility.',
      'Break-In',
      [
        createShot('shot-3-1', 1, 'loc-lab', 'Night', 'Kaito hacking the door panel. Sparks fly.', 4, IMAGES.KAITO, [{ id: 'char-kaito', activeLookId: 'look-kaito-2' }]),
        createShot('shot-3-2', 2, 'loc-lab', 'Night', 'The door slides open. Kenji enters with weapon drawn.', 5, IMAGES.SHOT_LAB, [{ id: 'char-kenji', activeLookId: 'look-kenji-1' }]),
        createShot('shot-3-3', 3, 'loc-lab', 'Night', 'Security droids (Unit 734s) activate in the background.', 4, IMAGES.CHEF, [{ id: 'char-chef', activeLookId: 'look-chef-2' }])
      ],
    ),
    createSequenceWithScene(
      'seq-4',
      'The Confrontation',
      'Kenji confronts Silas in his office.',
      'Boardroom Duel',
      [
        createShot('shot-4-1', 1, 'loc-board', 'Sunset', 'Wide shot of the boardroom. Silas stands by the window, back to camera.', 6, IMAGES.SILAS, [{ id: 'char-silas', activeLookId: 'look-silas-1' }]),
        createShot('shot-4-2', 2, 'loc-board', 'Sunset', 'Kenji aims his gun. "It ends here, Silas."', 3, IMAGES.KENJI_RAIN, [{ id: 'char-kenji', activeLookId: 'look-kenji-3' }]),
        createShot('shot-4-3', 3, 'loc-board', 'Sunset', 'Silas turns around, smiling. "Does it?"', 4, IMAGES.SILAS, [{ id: 'char-silas', activeLookId: 'look-silas-1' }])
      ],
    ),
  ]
};
