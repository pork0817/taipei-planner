// Approximate geography of Taipei City (current 12-district boundaries) and
// historical calibration tables. Coordinates are [lon, lat]; the game works in
// kilometres with x to the east and y to the south.

export const LON0 = 121.45, LAT0 = 25.215, KX = 100.85, KY = 110.9;
export const CELL = 0.2;            // km per grid cell (200 m)
export const GW = 111, GH = 145;    // grid size
export const ll = (lon, lat) => [(lon - LON0) * KX, (LAT0 - lat) * KY];
export const llp = p => ll(p[0], p[1]);

export const START_YEAR = 1949, END_YEAR = 2100;

export const OUTLINE = [
  [121.457, 25.125], [121.470, 25.160], [121.500, 25.195], [121.535, 25.212], [121.565, 25.205],
  [121.590, 25.180], [121.610, 25.150], [121.618, 25.120], [121.640, 25.100], [121.650, 25.080],
  [121.665, 25.062], [121.665, 25.035], [121.640, 25.015], [121.620, 24.990], [121.600, 24.965],
  [121.575, 24.960], [121.555, 24.975], [121.540, 24.990], [121.530, 25.005], [121.515, 25.010],
  [121.500, 25.018], [121.489, 25.030], [121.494, 25.046], [121.504, 25.058], [121.508, 25.072],
  [121.495, 25.088], [121.475, 25.098], [121.462, 25.112],
];

// Ordered so that small central districts win point-in-polygon tests.
export const DISTRICTS = [
  { key: 'zhongzheng', name: 'Zhongzheng', zh: '中正區', color: '#e57373', pop1949: 115000, core: [121.515, 25.040],
    poly: [[121.508, 25.048], [121.518, 25.048], [121.532, 25.046], [121.532, 25.025], [121.528, 25.008], [121.515, 25.010], [121.503, 25.020], [121.508, 25.032]] },
  { key: 'datong', name: 'Datong', zh: '大同區', color: '#f06292', pop1949: 135000, core: [121.512, 25.060],
    poly: [[121.494, 25.046], [121.508, 25.048], [121.518, 25.048], [121.518, 25.077], [121.508, 25.072], [121.504, 25.058]] },
  { key: 'wanhua', name: 'Wanhua', zh: '萬華區', color: '#ba68c8', pop1949: 140000, core: [121.500, 25.036],
    poly: [[121.489, 25.030], [121.494, 25.046], [121.508, 25.048], [121.508, 25.032], [121.503, 25.020], [121.500, 25.018]] },
  { key: 'zhongshan', name: 'Zhongshan', zh: '中山區', color: '#9575cd', pop1949: 85000, core: [121.527, 25.058],
    poly: [[121.518, 25.048], [121.532, 25.046], [121.548, 25.048], [121.548, 25.062], [121.552, 25.074], [121.565, 25.080], [121.555, 25.086], [121.530, 25.083], [121.518, 25.077]] },
  { key: 'songshan', name: 'Songshan', zh: '松山區', color: '#7986cb', pop1949: 40000, core: [121.572, 25.050],
    poly: [[121.548, 25.048], [121.578, 25.048], [121.580, 25.062], [121.575, 25.068], [121.565, 25.080], [121.552, 25.074], [121.548, 25.062]] },
  { key: 'daan', name: "Da'an", zh: '大安區', color: '#64b5f6', pop1949: 60000, core: [121.538, 25.030],
    poly: [[121.532, 25.046], [121.553, 25.047], [121.553, 25.020], [121.545, 25.012], [121.528, 25.008], [121.532, 25.025]] },
  { key: 'xinyi', name: 'Xinyi', zh: '信義區', color: '#4dd0e1', pop1949: 15000, core: [121.566, 25.034],
    poly: [[121.553, 25.047], [121.578, 25.048], [121.586, 25.036], [121.580, 25.020], [121.565, 25.014], [121.553, 25.020]] },
  { key: 'nangang', name: 'Nangang', zh: '南港區', color: '#4db6ac', pop1949: 15000, core: [121.608, 25.053],
    poly: [[121.578, 25.048], [121.580, 25.062], [121.590, 25.062], [121.620, 25.060], [121.650, 25.080], [121.665, 25.062], [121.665, 25.035], [121.640, 25.015], [121.605, 25.024], [121.586, 25.036]] },
  { key: 'neihu', name: 'Neihu', zh: '內湖區', color: '#81c784', pop1949: 12000, core: [121.590, 25.077],
    poly: [[121.565, 25.080], [121.575, 25.068], [121.580, 25.062], [121.590, 25.062], [121.620, 25.060], [121.650, 25.080], [121.640, 25.100], [121.618, 25.120], [121.610, 25.150], [121.600, 25.120], [121.575, 25.095]] },
  { key: 'wenshan', name: 'Wenshan', zh: '文山區', color: '#dce775', pop1949: 25000, core: [121.555, 24.995],
    poly: [[121.528, 25.008], [121.545, 25.012], [121.553, 25.020], [121.565, 25.014], [121.580, 25.020], [121.605, 25.024], [121.640, 25.015], [121.620, 24.990], [121.600, 24.965], [121.575, 24.960], [121.555, 24.975], [121.540, 24.990], [121.530, 25.005]] },
  { key: 'shilin', name: 'Shilin', zh: '士林區', color: '#ffd54f', pop1949: 40000, core: [121.524, 25.092],
    poly: [[121.518, 25.077], [121.530, 25.083], [121.555, 25.086], [121.565, 25.080], [121.575, 25.095], [121.600, 25.120], [121.610, 25.150], [121.590, 25.180], [121.565, 25.205], [121.535, 25.212], [121.540, 25.160], [121.522, 25.122], [121.500, 25.105], [121.475, 25.098], [121.495, 25.088], [121.508, 25.072]] },
  { key: 'beitou', name: 'Beitou', zh: '北投區', color: '#ffb74d', pop1949: 35000, core: [121.502, 25.130],
    poly: [[121.457, 25.125], [121.462, 25.112], [121.475, 25.098], [121.500, 25.105], [121.522, 25.122], [121.540, 25.160], [121.535, 25.212], [121.500, 25.195], [121.470, 25.160]] },
];

export const RIVERS = [
  { name: 'Tamsui River 淡水河', width: 0.42, cells: true, pts: [[121.548, 24.982], [121.535, 24.998], [121.525, 25.006], [121.512, 25.010], [121.499, 25.016], [121.487, 25.028], [121.491, 25.046], [121.502, 25.059], [121.506, 25.073], [121.493, 25.087], [121.472, 25.097], [121.458, 25.110], [121.447, 25.130], [121.438, 25.155], [121.430, 25.175]] },
  { name: 'Keelung River 基隆河', width: 0.24, cells: true, pts: [[121.672, 25.058], [121.640, 25.057], [121.615, 25.055], [121.595, 25.060], [121.582, 25.072], [121.568, 25.079], [121.552, 25.082], [121.535, 25.084], [121.520, 25.081], [121.512, 25.088], [121.500, 25.098], [121.485, 25.105], [121.468, 25.114], [121.458, 25.118]] },
  { name: 'Jingmei River 景美溪', width: 0.08, cells: false, pts: [[121.628, 24.996], [121.600, 24.990], [121.575, 24.992], [121.555, 24.993], [121.540, 24.991]] },
  { name: 'Shuangxi Creek 雙溪', width: 0.06, cells: false, pts: [[121.575, 25.120], [121.555, 25.105], [121.535, 25.095], [121.520, 25.086]] },
];

export const MOUNTAINS = [
  // Yangmingshan
  [[121.505, 25.142], [121.520, 25.128], [121.545, 25.118], [121.565, 25.106], [121.590, 25.102], [121.615, 25.122], [121.612, 25.155], [121.592, 25.185], [121.565, 25.212], [121.535, 25.218], [121.500, 25.200], [121.478, 25.172], [121.490, 25.152]],
  // Neihu northern hills
  [[121.578, 25.096], [121.600, 25.087], [121.630, 25.086], [121.646, 25.094], [121.622, 25.124], [121.602, 25.118]],
  // Nangang / Four Beasts hills
  [[121.570, 25.031], [121.586, 25.030], [121.620, 25.042], [121.668, 25.046], [121.668, 25.030], [121.642, 25.010], [121.600, 25.008], [121.574, 25.020]],
  // Wenshan hills (Maokong)
  [[121.566, 25.004], [121.600, 25.004], [121.632, 25.004], [121.616, 24.980], [121.597, 24.962], [121.575, 24.958], [121.566, 24.976], [121.561, 24.989]],
];

export const SONGSHAN_AIRPORT = { lon0: 121.537, lat0: 25.0735, lon1: 121.563, lat1: 25.066 };

export const SEED_ROADS = [
  { name: 'Zhongshan N. Rd 中山北路', type: 'avenue', pts: [[121.522, 25.046], [121.522, 25.070], [121.524, 25.085], [121.526, 25.096], [121.522, 25.110], [121.512, 25.122], [121.502, 25.134]] },
  { name: 'Zhongxiao Rd 忠孝路', type: 'avenue', pts: [[121.500, 25.046], [121.518, 25.046], [121.533, 25.043], [121.553, 25.041], [121.578, 25.042]] },
  { name: 'Roosevelt Rd 羅斯福路', type: 'avenue', pts: [[121.517, 25.032], [121.524, 25.022], [121.533, 25.013], [121.540, 25.002], [121.542, 24.992]] },
  { name: "Ren'ai Rd 仁愛路", type: 'street', pts: [[121.519, 25.038], [121.553, 25.038]] },
  { name: 'Zhonghua Rd 中華路', type: 'avenue', pts: [[121.507, 25.052], [121.507, 25.033]] },
  { name: 'Yanping N. Rd 延平北路', type: 'street', pts: [[121.511, 25.048], [121.511, 25.075]] },
  { name: 'Nanjing Rd 南京路', type: 'street', pts: [[121.510, 25.053], [121.548, 25.052], [121.578, 25.051]] },
  { name: 'Bade Rd 八德路', type: 'avenue', pts: [[121.578, 25.051], [121.595, 25.052], [121.615, 25.054], [121.645, 25.055]] },
  { name: 'Songshan Rd 松山路', type: 'street', pts: [[121.578, 25.042], [121.578, 25.051], [121.584, 25.066], [121.592, 25.080]] },
  { name: 'Heping Rd 和平路', type: 'street', pts: [[121.495, 25.030], [121.517, 25.027], [121.555, 25.025]] },
  { name: 'Xinyi Rd 信義路', type: 'street', pts: [[121.519, 25.034], [121.566, 25.032]] },
  { name: 'Muzha Rd 木柵路', type: 'street', pts: [[121.542, 24.992], [121.560, 24.990], [121.578, 24.988]] },
  { name: 'Keelung Rd 基隆路', type: 'street', pts: [[121.553, 25.052], [121.553, 25.032], [121.540, 25.015], [121.533, 25.013]] },
  { name: 'Boai Rd 博愛路', type: 'street', pts: [[121.512, 25.046], [121.512, 25.032]] },
  { name: 'Hengyang Rd 衡陽路', type: 'street', pts: [[121.505, 25.042], [121.517, 25.042]] },
  { name: 'Guilin Rd 桂林路', type: 'street', pts: [[121.497, 25.037], [121.507, 25.037]] },
  { name: 'Minsheng Rd 民生路', type: 'street', pts: [[121.512, 25.058], [121.548, 25.058]] },
  { name: 'Tianmu Rd 天母路', type: 'street', pts: [[121.512, 25.122], [121.530, 25.115]] },
  { name: 'Xiyuan Rd 西園路', type: 'street', pts: [[121.498, 25.045], [121.497, 25.025]] },
  { name: 'Chengde Rd 承德路', type: 'street', pts: [[121.517, 25.048], [121.517, 25.078]] },
];

// Pre-existing 1949 rail (TRA Western Line and the old Tamsui Line).
export const SEED_RAIL = [
  { name: 'TRA Western Line', color: '#455a64', headway: 30, stations: [
    ['Banqiao 板橋', 121.463, 25.014], ['Wanhua 萬華', 121.500, 25.033], ['Taipei Main 台北', 121.517, 25.047],
    ['Songshan 松山', 121.578, 25.049], ['Nangang 南港', 121.607, 25.052], ['Xizhi 汐止', 121.660, 25.063]] },
  { name: 'TRA Tamsui Line', color: '#8d6e63', headway: 40, stations: [
    ['Taipei Main 台北', 121.517, 25.047], ['Shuanglian 雙連', 121.521, 25.058], ['Yuanshan 圓山', 121.520, 25.071],
    ['Shilin 士林', 121.526, 25.093], ['Shipai 石牌', 121.515, 25.115], ['Beitou 北投', 121.498, 25.132], ['Tamsui 淡水', 121.445, 25.168]] },
];

// Pre-1949 special sites. s: 1 park, 2 school, 3 hospital, 4 market, 6 university
export const SEED_SPECIALS = [
  { s: 6, at: [121.539, 25.017], n: 4, name: 'National Taiwan University' },
  { s: 3, at: [121.519, 25.041], n: 1, name: 'NTU Hospital' },
  { s: 1, at: [121.515, 25.0425], n: 1, name: 'New Park' },
  { s: 1, at: [121.509, 25.032], n: 1, name: 'Botanical Garden' },
  { s: 4, at: [121.524, 25.088], n: 1, name: 'Shilin Market' },
  { s: 4, at: [121.499, 25.037], n: 1, name: 'Longshan Market' },
  { s: 2, at: [121.513, 25.037], n: 1, name: 'School' },
  { s: 2, at: [121.529, 25.060], n: 1, name: 'School' },
  { s: 1, at: [121.502, 25.137], n: 2, name: 'Beitou Park' },
];

// zone: 1 R, 2 C, 3 Mixed, 4 Office, 5 Industrial
export const SEED_SPOTS = [
  { at: [121.506, 25.043], zone: 2, level: 3, n: 4 },  // Ximending
  { at: [121.511, 25.056], zone: 2, level: 3, n: 4 },  // Dadaocheng
  { at: [121.514, 25.045], zone: 4, level: 3, n: 4 },  // government quarter
  { at: [121.494, 25.034], zone: 5, level: 2, n: 5 },  // Wanhua riverside
  { at: [121.507, 25.066], zone: 5, level: 2, n: 3 },
  { at: [121.612, 25.050], zone: 5, level: 2, n: 7 },  // Nangang industry
  { at: [121.561, 25.044], zone: 5, level: 2, n: 3 },  // Songshan tobacco factory
  { at: [121.582, 25.052], zone: 5, level: 1, n: 3 },
];

// Regional demand: millions of people who would live in Taipei City (current
// borders) at neutral attractiveness. Roughly follows the real census.
export const DEMAND = [[1949, 0.74], [1955, 0.98], [1960, 1.22], [1965, 1.5], [1970, 1.8], [1975, 2.06], [1980, 2.27], [1985, 2.5], [1990, 2.72], [1995, 2.66], [2000, 2.65], [2010, 2.62], [2020, 2.6], [2025, 2.5], [2040, 2.35], [2060, 2.12], [2080, 1.92], [2100, 1.78]];

export const OWN_CAR = [[1949, 0.004], [1960, 0.008], [1970, 0.03], [1980, 0.10], [1990, 0.22], [2000, 0.30], [2020, 0.33], [2050, 0.30], [2100, 0.25]];
export const OWN_SCOOTER = [[1949, 0.003], [1960, 0.04], [1970, 0.2], [1980, 0.45], [1990, 0.62], [2000, 0.68], [2020, 0.65], [2050, 0.55], [2100, 0.45]];
export const OWN_BIKE = [[1949, 0.45], [1970, 0.40], [1990, 0.22], [2010, 0.30], [2020, 0.40], [2100, 0.45]];

export const JOB_RATIO = [[1949, 0.36], [1970, 0.45], [1990, 0.55], [2020, 0.62], [2100, 0.60]];
export const SHARE_IND = [[1949, 0.22], [1965, 0.32], [1980, 0.25], [1995, 0.12], [2010, 0.06], [2100, 0.03]];
export const SHARE_OFF = [[1949, 0.12], [1970, 0.18], [1990, 0.35], [2010, 0.48], [2050, 0.55], [2100, 0.58]];

// GDP per job, thousand NT$ (2020 prices)
export const PRODUCTIVITY = [[1949, 120], [1960, 190], [1970, 380], [1980, 750], [1990, 1250], [2000, 1700], [2010, 2050], [2020, 2400], [2040, 3000], [2070, 3700], [2100, 4400]];
export const SHOCKS = [[1949, 1], [1996.5, 1], [1998, 0.97], [1999.5, 1], [2008.3, 1], [2009, 0.95], [2010.5, 1], [2019.9, 1], [2020.4, 0.96], [2021.5, 1], [2100, 1]];

// Maximum building height level allowed by construction technology
export const ERA_MAX_LEVEL = [[1949, 3], [1964, 4], [1978, 5], [1993, 6]];

export const EVENTS = [
  { y: 1949, m: 11, t: 'The central government relocates to Taipei. Hundreds of thousands of migrants arrive and housing is scarce.' },
  { y: 1951, m: 3, t: 'US aid begins. Light industry and reconstruction expand along the rivers.' },
  { y: 1958, m: 5, t: 'Bicycles and pedicabs still dominate the streets.' },
  { y: 1964, m: 4, t: 'High-rise construction techniques arrive: buildings up to level 4 are now possible.' },
  { y: 1966, m: 8, t: 'Domestic scooter assembly booms. Scooter ownership is climbing fast.' },
  { y: 1967, m: 6, t: 'Taipei becomes a special municipality.' },
  { y: 1968, m: 6, t: 'Neihu, Nangang, Muzha, Jingmei, Shilin and Beitou merge into Taipei City.' },
  { y: 1974, m: 1, t: 'The Ten Major Construction Projects begin. Demand for expressways and airports grows.' },
  { y: 1978, m: 2, t: 'Steel-frame towers are now possible (level 5).' },
  { y: 1979, m: 1, t: 'Taoyuan International Airport opens. Songshan Airport moves to domestic flights.' },
  { y: 1987, m: 6, t: 'Martial law ends. Incomes are booming and car ownership is accelerating.' },
  { y: 1993, m: 1, t: 'Super-tall construction is unlocked (level 6).' },
  { y: 1997, m: 9, t: 'The Asian financial crisis slows growth.' },
  { y: 2008, m: 9, t: 'Global financial crisis. Songshan resumes cross-strait flights.' },
  { y: 2009, m: 2, t: 'Public bike sharing launches. Bike lanes now matter more.' },
  { y: 2020, m: 1, t: 'Pandemic: travel demand and GDP dip briefly.' },
  { y: 2025, m: 6, t: 'Taiwan becomes a super-aged society. Housing demand softens.' },
  { y: 2050, m: 0, t: 'Net-zero 2050 target year. How green is your modal share?' },
  { y: 2099, m: 11, t: 'The century closes. Check your Planner Rating!' },
];

export function interp(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}
