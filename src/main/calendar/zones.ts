/**
 * Time zones a feed names (TZID) without defining them in a VTIMEZONE. ical.js would read
 * such times as the PC's local time, which is wrong whenever the zones differ; these
 * helpers resolve the name with the system's own zone data (Intl) instead.
 */

/** Outlook / Exchange use Windows zone names; the common ones, mapped to IANA (CLDR windowsZones). */
const WINDOWS_ZONES: Readonly<Record<string, string>> = {
  'Dateline Standard Time': 'Etc/GMT+12',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Alaskan Standard Time': 'America/Anchorage',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Pacific Standard Time (Mexico)': 'America/Tijuana',
  'US Mountain Standard Time': 'America/Phoenix',
  'Mountain Standard Time': 'America/Denver',
  'Mountain Standard Time (Mexico)': 'America/Mazatlan',
  'Central Standard Time': 'America/Chicago',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'Canada Central Standard Time': 'America/Regina',
  'Central America Standard Time': 'America/Guatemala',
  'Eastern Standard Time': 'America/New_York',
  'US Eastern Standard Time': 'America/Indiana/Indianapolis',
  'SA Pacific Standard Time': 'America/Bogota',
  'Venezuela Standard Time': 'America/Caracas',
  'Atlantic Standard Time': 'America/Halifax',
  'Newfoundland Standard Time': 'America/St_Johns',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
  'Pacific SA Standard Time': 'America/Santiago',
  'SA Eastern Standard Time': 'America/Cayenne',
  'Azores Standard Time': 'Atlantic/Azores',
  'Cape Verde Standard Time': 'Atlantic/Cape_Verde',
  UTC: 'Etc/UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'Morocco Standard Time': 'Africa/Casablanca',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'W. Central Africa Standard Time': 'Africa/Lagos',
  'GTB Standard Time': 'Europe/Bucharest',
  'FLE Standard Time': 'Europe/Kiev',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Egypt Standard Time': 'Africa/Cairo',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Russian Standard Time': 'Europe/Moscow',
  'Arab Standard Time': 'Asia/Riyadh',
  'E. Africa Standard Time': 'Africa/Nairobi',
  'Iran Standard Time': 'Asia/Tehran',
  'Arabian Standard Time': 'Asia/Dubai',
  'Afghanistan Standard Time': 'Asia/Kabul',
  'Pakistan Standard Time': 'Asia/Karachi',
  'West Asia Standard Time': 'Asia/Tashkent',
  'India Standard Time': 'Asia/Kolkata',
  'Sri Lanka Standard Time': 'Asia/Colombo',
  'Nepal Standard Time': 'Asia/Kathmandu',
  'Central Asia Standard Time': 'Asia/Almaty',
  'Bangladesh Standard Time': 'Asia/Dhaka',
  'Myanmar Standard Time': 'Asia/Yangon',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'Taipei Standard Time': 'Asia/Taipei',
  'W. Australia Standard Time': 'Australia/Perth',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland'
}

const formatters = new Map<string, Intl.DateTimeFormat | null>()

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  let formatter = formatters.get(zone)
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric'
      })
    } catch {
      formatter = null
    }
    formatters.set(zone, formatter)
  }
  return formatter
}

/** An IANA zone the system knows for this TZID, or null (then the time stays the PC's local time). */
export function resolveZone(tzid: string): string | null {
  const name = tzid.trim().replace(/^"|"$/g, '')
  const windows = WINDOWS_ZONES[name]
  if (windows !== undefined && formatterFor(windows) !== null) return windows
  // Some generators prefix the IANA name ("/mozilla.org/20050126_1/America/New_York").
  const parts = name.split('/').filter((part) => part !== '')
  for (let first = 0; first < parts.length; first++) {
    const candidate = parts.slice(first).join('/')
    if (candidate.includes('/') || candidate === 'UTC' || candidate === 'GMT') {
      if (formatterFor(candidate) !== null) return candidate
    }
  }
  return null
}

/** Milliseconds the zone is ahead of UTC at this instant. */
function offsetAt(at: number, formatter: Intl.DateTimeFormat): number {
  const parts: Record<string, number> = {}
  for (const part of formatter.formatToParts(at)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  const wall = Date.UTC(parts.year ?? 0, (parts.month ?? 1) - 1, parts.day ?? 1, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0)
  return wall - Math.floor(at / 1000) * 1000
}

/** The instant a wall-clock time in an IANA zone denotes (month is 1-based). */
export function zonedTime(zone: string, year: number, month: number, day: number, hour: number, minute: number, second: number): number | null {
  const formatter = formatterFor(zone)
  if (formatter === null) return null
  const wall = Date.UTC(year, month - 1, day, hour, minute, second)
  // Two passes settle the offset, also on days the clocks change.
  const guess = wall - offsetAt(wall, formatter)
  return wall - offsetAt(guess, formatter)
}
