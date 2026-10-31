export const RIDER_OPTIONS = [
  { id: 'red', label: 'Red hoodie' },
  { id: 'black', label: 'Black cap' },
];

export const DEFAULT_RIDER = 'red';

export function validRider(value) {
  return RIDER_OPTIONS.some((option) => option.id === value);
}

export function loadRiderPreference(storage = localStorage) {
  const stored = storage.getItem('downhill.rider');
  return validRider(stored) ? stored : DEFAULT_RIDER;
}

export function saveRiderPreference(value, storage = localStorage) {
  const rider = validRider(value) ? value : DEFAULT_RIDER;
  storage.setItem('downhill.rider', rider);
  return rider;
}
