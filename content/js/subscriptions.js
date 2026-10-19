// US list prices checked in 2026. Student, military, and first-responder amounts
// are included only where a published plan states them. A missing discount stays
// at the full price.

export const subscriptionCatalog = [
  { id: 'youtube', name: 'YouTube Premium', group: 'Video', plan: 'Individual', monthly: 16 },
  { id: 'youtubelite', name: 'YouTube Premium Lite', group: 'Video', plan: 'Lite', monthly: 9 },
  { id: 'netflix', name: 'Netflix', group: 'Video', plan: 'Standard', monthly: 20 },
  { id: 'netflixads', name: 'Netflix with ads', group: 'Video', plan: 'Standard with ads', monthly: 9 },
  { id: 'netflixprem', name: 'Netflix Premium', group: 'Video', plan: 'Premium', monthly: 27 },
  { id: 'disney', name: 'Disney+', group: 'Video', plan: 'With ads', monthly: 12.49 },
  { id: 'disneyprem', name: 'Disney+ Premium', group: 'Video', plan: 'Premium', monthly: 21.49, militaryNote: 'Exchange members can get 25% off the annual Premium plan.' },
  { id: 'hulu', name: 'Hulu', group: 'Video', plan: 'With ads', monthly: 12.49, student: 1.99 },
  { id: 'huluprem', name: 'Hulu Premium', group: 'Video', plan: 'No ads', monthly: 19 },
  { id: 'max', name: 'HBO Max', group: 'Video', plan: 'Basic with ads', monthly: 11, annual: 110, student: 5.49 },
  { id: 'maxstd', name: 'HBO Max Standard', group: 'Video', plan: 'Standard', monthly: 18.5, annual: 185 },
  { id: 'paramount', name: 'Paramount+', group: 'Video', plan: 'Essential', monthly: 9, annual: 90, student: 4.5 },
  { id: 'paramountprem', name: 'Paramount+ Premium', group: 'Video', plan: 'Premium', monthly: 14, annual: 140 },
  { id: 'peacock', name: 'Peacock', group: 'Video', plan: 'Premium', monthly: 13, annual: 130, military: 6.99, responder: 7.99, responderNote: 'First responder price for 12 months.' },
  { id: 'peacockplus', name: 'Peacock Premium Plus', group: 'Video', plan: 'Premium Plus', monthly: 20, annual: 200 },
  { id: 'peacockselect', name: 'Peacock Select', group: 'Video', plan: 'Select', monthly: 9, annual: 90 },
  { id: 'discovery', name: 'discovery+', group: 'Video', plan: 'With ads', monthly: 6.99 },
  { id: 'discoveryfree', name: 'discovery+ Ad-Free', group: 'Video', plan: 'Ad-free', monthly: 11.99 },
  { id: 'appletv', name: 'Apple TV', group: 'Video', plan: 'Monthly', monthly: 15, annual: 119 },
  { id: 'crunchy', name: 'Crunchyroll', group: 'Video', plan: 'Fan', monthly: 10 },
  { id: 'crunchymega', name: 'Crunchyroll Mega Fan', group: 'Video', plan: 'Mega Fan', monthly: 14 },
  { id: 'crunchyult', name: 'Crunchyroll Ultimate Fan', group: 'Video', plan: 'Ultimate Fan', monthly: 18 },
  { id: 'espn', name: 'ESPN Select', group: 'Video', plan: 'Select', monthly: 13 },
  { id: 'youtubetv', name: 'YouTube TV', group: 'Live TV', plan: 'Base', monthly: 82.99, military: 67.99, responder: 67.99, militaryNote: 'Military price for 12 months.', responderNote: 'First responder price for 12 months.' },
  { id: 'foxnation', name: 'Fox Nation', group: 'Live TV', plan: 'Monthly', monthly: 9.99, annual: 71.88, responder: 0, responderNote: 'First year free. Annual renewals are 50% off.' },
  { id: 'primevideo', name: 'Prime Video', group: 'Video', plan: 'With ads', monthly: 8.99 },
  { id: 'spotify', name: 'Spotify', group: 'Music', plan: 'Premium Individual', monthly: 13, student: 6.99 },
  { id: 'spotifyduo', name: 'Spotify Duo', group: 'Music', plan: 'Duo', monthly: 19 },
  { id: 'spotifyfamily', name: 'Spotify Family', group: 'Music', plan: 'Family', monthly: 22 },
  { id: 'applemusic', name: 'Apple Music', group: 'Music', plan: 'Individual', monthly: 11.99, student: 6.99 },
  { id: 'amazonmusic', name: 'Amazon Music Unlimited', group: 'Music', plan: 'Individual', monthly: 13 },
  { id: 'amazonmusicprime', name: 'Amazon Music Unlimited Prime', group: 'Music', plan: 'Prime member', monthly: 12 },
  { id: 'prime', name: 'Amazon Prime', group: 'Membership', plan: 'Monthly', monthly: 14.99, student: 7.49 },
  { id: 'dashpass', name: 'DoorDash DashPass', group: 'Membership', plan: 'Monthly', monthly: 8 },
  { id: 'uberone', name: 'Uber One', group: 'Membership', plan: 'Monthly', monthly: 9.99 },
  { id: 'peloton', name: 'Peloton App One', group: 'Fitness', plan: 'App One', monthly: 12.99, responder: 9.99, responderNote: 'First responder price. App membership starts at $9.99.' },
  { id: 'icloud', name: 'iCloud+', group: 'Storage', plan: '50 GB', monthly: 0.99 },
  { id: 'googleone', name: 'Google One', group: 'Storage', plan: '100 GB', monthly: 1.99 },
  { id: 'dropbox', name: 'Dropbox Plus', group: 'Storage', plan: 'Plus', monthly: 9.99 },
  { id: 'chatgpt', name: 'ChatGPT Go', group: 'Tools', plan: 'Go', monthly: 8 },
]

const byId = Object.fromEntries(subscriptionCatalog.map((service) => [service.id, service]))

export function subscriptionById(id) {
  return byId[id] || null
}

export function quoteSubscription(service, discount, billing) {
  if (!service) return null
  if (discount === 'student' && service.student != null) return { monthly: service.student, note: 'Student price' }
  if (discount === 'military' && service.military != null) return { monthly: service.military, note: service.militaryNote || 'Military price' }
  if (discount === 'responder' && service.responder != null) return { monthly: service.responder, note: service.responderNote || 'First responder price' }
  if (billing === 'annual' && service.annual != null) return { monthly: service.annual / 12, note: 'Annual price, per month' }
  if (discount === 'student') return { monthly: service.monthly, note: service.studentNote || 'Full price. No student price is published.' }
  if (discount === 'military') return { monthly: service.monthly, note: service.militaryNote || 'Full price. No military price is published.' }
  if (discount === 'responder') return { monthly: service.monthly, note: 'Full price. No first responder price is published.' }
  if (billing === 'annual') return { monthly: service.monthly, note: 'Monthly price. No annual discount is published.' }
  return { monthly: service.monthly, note: service.plan }
}
