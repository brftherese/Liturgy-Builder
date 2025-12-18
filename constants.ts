
import { LiturgyItem, MassMetadata, PageSettings } from './types';

export const DEFAULT_METADATA: MassMetadata = {
  churchName: "St. Ignatius of Loyola Parish",
  date: new Date().toISOString().split('T')[0],
  time: "7:30 AM & 10:00 AM",
  celebrant: "Fr. Francis Therese Krautter CSJ",
  occasion: "Sunday Mass",
  ordinarySetting: "Missa de Angelis (Mass VIII)"
};

export const DEFAULT_PAGE_SETTINGS: PageSettings = {
  size: 'statement', // 5.5 x 8.5
  orientation: 'portrait',
  margins: 0.5,
  fontSize: 11,
  fontScale: 1.0,
  lineHeight: 1.3,
  verticalGapScale: 1.0,
  headerScale: 1.0,
  colorMode: 'color'
};

export const COMMON_ORDINARIES = [
  "Mass I (Lux et origo) - Easter",
  "Mass II (Kyrie fons bonitatis)",
  "Mass III (Kyrie Deus sempiterne)",
  "Mass IV (Cunctipotens Genitor Deus) - Feasts",
  "Mass V (Kyrie magnae Deus potentiae)",
  "Mass VI (Kyrie Rex Genitor)",
  "Mass VII (Kyrie Rex splendens)",
  "Mass VIII (De Angelis) - Common",
  "Mass IX (Cum jubilo) - Marian",
  "Mass X (Alme Pater)",
  "Mass XI (Orbis factor) - Sundays",
  "Mass XII (Pater cuncta)",
  "Mass XIII (Stelliferi Conditor orbis)",
  "Mass XIV (Jesu Redemptor)",
  "Mass XVI (Nullus)",
  "Mass XVII (Salve) - Advent/Lent",
  "Mass XVIII (Deus Genitor alme) - Weekdays/Requiem",
  "Credo I",
  "Credo II",
  "Credo III",
  "Credo IV",
  "Missa Primitiva",
  "Heritage Mass",
  "Roman Missal (English)"
];

export const INITIAL_ITEMS: LiturgyItem[] = [
  {
    id: '1',
    type: 'proper',
    title: 'Introit',
    content: 'English text of the Entrance Antiphon...',
    metadata: { latinContent: 'Latin text of the Introit...' }
  },
  {
    id: '2',
    type: 'ordinary',
    title: 'Kyrie',
    content: '',
    metadata: { setting: 'Missa de Angelis (Mass VIII)' }
  },
  {
    id: '3',
    type: 'ordinary',
    title: 'Gloria',
    content: '',
    metadata: { setting: 'Missa de Angelis (Mass VIII)' }
  },
  {
    id: '4',
    type: 'reading',
    title: 'First Reading',
    content: 'One line summary of the reading italicized and centered.',
    metadata: { reference: 'Citation (e.g. Is 55:10-11)' }
  },
  {
    id: '5',
    type: 'proper',
    title: 'Gradual',
    content: 'English text of the Gradual...',
    metadata: { latinContent: 'Latin text of the Gradual...' }
  },
  {
    id: '6',
    type: 'reading',
    title: 'Second Reading',
    content: 'One line summary of the reading.',
    metadata: { reference: 'Citation' }
  },
  {
    id: '7',
    type: 'proper',
    title: 'Alleluia',
    content: 'English text...',
    metadata: { latinContent: 'Alleluia...' }
  },
  {
    id: '8',
    type: 'reading',
    title: 'Gospel',
    content: 'One line summary of the Gospel.',
    metadata: { reference: 'Citation' }
  },
  {
    id: '9',
    type: 'ordinary',
    title: 'Credo',
    content: '',
    metadata: { setting: 'Credo III', pageNumber: '10' }
  },
  {
    id: '10',
    type: 'proper',
    title: 'Offertorio',
    content: 'English text...',
    metadata: { latinContent: 'Latin text...' }
  },
  {
    id: '11',
    type: 'hymn',
    title: 'Offertory Hymn',
    content: 'Hymn lyrics or Polyphony text...',
    metadata: { latinContent: '', pageNumber: '123' }
  },
  {
    id: '12',
    type: 'ordinary',
    title: 'Sanctus',
    content: '',
    metadata: { setting: 'Missa de Angelis (Mass VIII)' }
  },
  {
    id: '13',
    type: 'ordinary',
    title: 'Agnus Dei',
    content: '',
    metadata: { setting: 'Missa de Angelis (Mass VIII)' }
  },
  {
    id: '14',
    type: 'proper',
    title: 'Communio',
    content: 'English text...',
    metadata: { latinContent: 'Latin text...' }
  },
  {
    id: '15',
    type: 'hymn',
    title: 'Communion Hymn',
    content: 'Hymn lyrics...',
    metadata: { pageNumber: '456' }
  },
  {
    id: '16',
    type: 'hymn',
    title: 'Recessional Hymn',
    content: '',
    metadata: { pageNumber: '789', tune: 'HYMN TO JOY' }
  }
];

export const PAGE_DIMENSIONS = {
  letter: { width: '8.5in', height: '11in', printClass: 'w-[8.5in] h-[11in]' },
  statement: { width: '5.5in', height: '8.5in', printClass: 'w-[5.5in] h-[8.5in]' }, // Half letter
  legal: { width: '8.5in', height: '14in', printClass: 'w-[8.5in] h-[14in]' },
};
