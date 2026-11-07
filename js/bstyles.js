// Architectural styles for buildings. They change how buildings look in 3D and
// have small effects on land value (and therefore growth) for some zones.
export const BSTYLES = [
  { key: 'taipei', label: 'Taipei', zh: '台式', desc: 'Tiled walk-ups, shophouses with arcades, rooftop water tanks. Small retail bonus for mixed-use.',
    walls: ['#e9e4d8', '#d9d2c3', '#cfc8bb', '#e3ddd0', '#bdb7ab', '#d8c9b1', '#c9d1d3'], glass: ['#7d93a6', '#8aa0ad', '#6f8495'],
    roof: 'flat', tank: true, lv: { 3: 0.12, 2: 0.06 } },
  { key: 'modern', label: 'Modern glass', zh: '現代', desc: 'Curtain-wall towers in glass and steel. Bonus for offices.',
    walls: ['#a9bccb', '#8fa7ba', '#c4d2dc', '#7f95a8', '#b5c3cc'], glass: ['#4f6f8f', '#5d82a3', '#3e5d7c', '#6a8fae'],
    roof: 'flat', glassy: true, lv: { 4: 0.18, 2: 0.08 } },
  { key: 'japanese', label: 'Japanese', zh: '日式', desc: 'Clean white and grey facades, pitched tile roofs on low-rise. Bonus for residential.',
    walls: ['#f2f0ea', '#e6e3dc', '#d6d4cf', '#ece7dd', '#c8c6c1'], glass: ['#8a9aa6', '#7b8b97'], roofCol: ['#4b5560', '#5a636d', '#3f4851'],
    roof: 'gable', lv: { 1: 0.1, 3: 0.06 } },
  { key: 'dutch', label: 'Dutch', zh: '荷式', desc: 'Narrow brick rowhouses with steep gables. Bonus for mixed-use and shops.',
    walls: ['#9b4a32', '#8a3f2b', '#a85a3c', '#7d3b2a', '#b06b4a'], glass: ['#5f6a72'], roofCol: ['#3a3a3a', '#4a3a32', '#2f2f33'],
    roof: 'steep', lv: { 3: 0.1, 2: 0.08 } },
  { key: 'british', label: 'British', zh: '英式', desc: 'Brick and stone terraces with slate roofs and chimneys. Bonus for residential.',
    walls: ['#a8644a', '#c9b79c', '#8e5a45', '#d6c8ae', '#b07a5e'], glass: ['#5c6670'], roofCol: ['#4f555c', '#5d6168', '#454a50'],
    roof: 'gable', chimney: true, lv: { 1: 0.08, 3: 0.05 } },
  { key: 'american', label: 'American', zh: '美式', desc: 'Detached houses on big lots, big-box shops and glass downtown towers. Bonus for commercial.',
    walls: ['#e8dcc6', '#d9c3a3', '#f0eadf', '#c7b597', '#b8c4cc'], glass: ['#5d7286', '#4c6275'], roofCol: ['#6b5444', '#5a4a40', '#70665c'],
    roof: 'gable', suburban: true, lv: { 2: 0.12, 4: 0.06 } },
];
export const styleIndex = key => Math.max(0, BSTYLES.findIndex(s => s.key === key));
