// Component data for the XTX Tower mockup. All sizes are millimetres.
//
// GPU sizes are length x height x thickness as published by the maker or
// measured in reviews. Check your exact card before cutting anything.

export const GPUS = {
  reference: {
    name: 'AMD reference (MBA)',
    l: 287, h: 123, t: 51, slots: 2.5,
    watts: 355, pins: 2,
    note: '355 W total board power, 2 × 8-pin.',
    style: { shroud: '#2b2d31', trim: '#45484e', accent: '#d8262c', fanRing: '#3a3d42' },
  },
  nitro: {
    name: 'Sapphire NITRO+ Vapor-X',
    l: 320, h: 136, t: 72, slots: 3.5,
    watts: 420, pins: 3,
    note: '420 W total board power on the primary BIOS, 3 × 8-pin.',
    style: { shroud: '#1d1f23', trim: '#8e949c', accent: '#5aa9ff', fanRing: '#2a2d32' },
  },
  tuf: {
    name: 'ASUS TUF Gaming OC',
    l: 353, h: 158, t: 73, slots: 3.63,
    watts: 400, pins: 3,
    note: 'No official board power is published; 400 W is a budgeting allowance. 3 × 8-pin.',
    style: { shroud: '#34363a', trim: '#5c6067', accent: '#c9a227', fanRing: '#26282c' },
  },
  custom: {
    name: 'Custom size',
    l: 300, h: 130, t: 60, slots: 3,
    watts: 375, pins: 3,
    note: 'Enter your own card.',
    style: { shroud: '#26282c', trim: '#6b7079', accent: '#e05656', fanRing: '#30333a' },
  },
};

// `w` runs from the rear I/O edge into the board, `l` along the rear edge.
// In the drawer the rear edge faces the spine.
export const BOARDS = {
  atx: {
    name: 'ATX (AM5 / LGA1851)',
    w: 244, l: 305,
    cpuWatts: 250,
    socket: { u: 110, v: 88, size: 72 },
    dimms: [160, 170, 180, 190],
    // Typical lane split per card count, listed by slot from the CPU down.
    lanes: [['x16 CPU'], ['x8 CPU', 'x8 CPU'], ['x8 CPU', 'x8 CPU', 'x4 chipset'], ['x8 CPU', 'x8 CPU', 'x4 chipset', 'x4 chipset']],
  },
  eatx: {
    name: 'E-ATX (TRX50 Threadripper)',
    w: 330, l: 305,
    cpuWatts: 350,
    socket: { u: 165, v: 100, size: 100 },
    dimms: [232, 242, 252, 262],
    lanes: [['x16'], ['x16', 'x16'], ['x16', 'x16', 'x16'], ['x16', 'x16', 'x16', 'x8']],
  },
  eeb: {
    name: 'SSI-EEB (WRX90 Threadripper PRO)',
    w: 330, l: 305,
    cpuWatts: 350,
    socket: { u: 165, v: 100, size: 100 },
    dimms: [68, 78, 88, 98, 232, 242, 252, 262],
    lanes: [['x16'], ['x16', 'x16'], ['x16', 'x16', 'x16'], ['x16', 'x16', 'x16', 'x16']],
  },
};

// Expansion slot numbers (1 = closest to the CPU) used for 1-4 cards.
export const SLOT_SETS = [[1], [1, 4], [1, 4, 7], [1, 3, 5, 7]];

export const PSU_RATINGS = [850, 1000, 1200, 1300, 1500, 1600];

export const MAINS = {
  '230-10': { volts: 230, amps: 10, label: '230 V / 10 A' },
  '230-16': { volts: 230, amps: 16, label: '230 V / 16 A' },
  '120-15': { volts: 120, amps: 15, label: '120 V / 15 A' },
  '120-20': { volts: 120, amps: 20, label: '120 V / 20 A' },
};

// Common off-the-shelf PCIe riser lengths.
export const RISER_LENGTHS = [150, 200, 250, 300, 400, 500, 600];

// Free-air flow of a typical case fan at about 1800-2000 rpm, in m3/h.
export const FAN_FLOW = { 120: 100, 140: 120 };
