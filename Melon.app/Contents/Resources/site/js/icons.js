const paths = {
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2"/>',
  clock: '<circle cx="12" cy="12" r="7.5"/><path d="M12 8v4.5l3 2"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  trend: '<path d="m4 16 5.5-5.5 3.5 3L20 7"/>',
  percent: '<circle cx="7.5" cy="7.5" r="2.2"/><circle cx="16.5" cy="16.5" r="2.2"/><path d="M18 6 6 18"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>',
  car: '<path d="M4 15.5h16"/><path d="M6.2 15.5 8 10.5h7.2l2.6 5"/><path d="M8.4 10.5 9.4 7.8h4.6l1.2 2.7"/><circle cx="8" cy="16.8" r="1.5"/><circle cx="16.2" cy="16.8" r="1.5"/>',
  lease: '<path d="M3.5 16h11"/><path d="M5.2 16 6.6 12h5l1.8 4"/><circle cx="6.4" cy="17.2" r="1.3"/><circle cx="12.4" cy="17.2" r="1.3"/><path d="M16 8.5a3.2 3.2 0 1 1 1.2 2.5"/><path d="M17.2 6.2v3h3"/>',
  credit: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 14.5h5"/>',
  scale: '<path d="M12 4v15M8 20h8M12 6 5.5 10h13z"/><path d="M5.5 10 4 13.2a2 2 0 0 0 3.8 0zM18.5 10 17 13.2a2 2 0 0 0 3.8 0z"/>',
  globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4c2.2 2.3 3.3 5 3.3 8s-1.1 5.7-3.3 8c-2.2-2.3-3.3-5-3.3-8s1.1-5.7 3.3-8z"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4.5V9h-4.5"/>',
  home: '<path d="M4 11.5 12 5l8 6.5"/><path d="M7 10.8V19h10v-8.2"/>',
  key: '<circle cx="8.5" cy="14.5" r="3.2"/><path d="M11.2 14.5H20l-1.6-1.8M16.2 14.5l1.6-1.8"/>',
  receipt: '<path d="M7 3.5h10v17l-2.2-1.4L12 20.5l-2.8-1.4L7 20.5v-17z"/><path d="M10 8h4M10 12h4"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>',
  sun: '<circle cx="12" cy="12" r="3.2"/><path d="M12 4v2.2M12 17.8V20M4 12h2.2M17.8 12H20M6.4 6.4l1.6 1.6M16 16l1.6 1.6M17.6 6.4 16 8M8 16l-1.6 1.6"/>',
  wage: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5v9M14.4 9.2c-.4-.6-1.1-.9-2.1-.9-1.3 0-2.1.6-2.1 1.6 0 2.2 4.4 1.1 4.4 3.2 0 1-.8 1.7-2.2 1.7-1 0-1.8-.4-2.2-1"/>',
  overtime: '<circle cx="12" cy="13" r="6.5"/><path d="M12 10v3.2l2.2 1.4"/><path d="M8 4.5h8M9 3v3M15 3v3"/>',
  calc: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8 7h8M8 11.5h.01M12 11.5h.01M16 11.5h.01M8 15.5h.01M12 15.5h.01M16 15.5h.01"/>',
  sci: '<path d="M3.5 16c1.7-5.2 3.3-5.2 5 0s3.3 5.2 5 0 3.3-5.2 5 0"/><path d="M4 7.2h3.4M5.7 5.5v3.4"/>',
  subs: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="m10 9 5 3-5 3z"/>',
  download: '<path d="M12 4v10"/><path d="m8 10 4 4 4-4"/><path d="M5 18h14"/>',
  sheet: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M4 14h16M10 4v16"/>',
}

export function icon(name, size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`
}
