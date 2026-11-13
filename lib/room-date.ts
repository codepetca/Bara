const roomDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function roomDate(now: number) {
  const date = Object.fromEntries(roomDateFormatter.formatToParts(now).map(({ type, value }) => [type, value]));
  return [date.year, date.month, date.day].join("-");
}

export function nextRoomDay(now: number) {
  const date = roomDate(now);
  let start = now;
  let end = now + 26 * 60 * 60_000;
  // The local day can run 23 or 25 hours at a daylight-saving transition.
  while (end - start > 1) {
    const middle = Math.floor((start + end) / 2);
    if (roomDate(middle) === date) start = middle;
    else end = middle;
  }
  return end;
}

export function roomWindowEnd(now: number) {
  const cutoff = now + 10 * 60_000;
  return roomDate(cutoff) === roomDate(now) ? cutoff : nextRoomDay(now);
}
