const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
const aliases: Record<string, string> = {
  vw: 'volkswagen',
  'mercedes-benz': 'mercedes',
  'mercedes benz': 'mercedes',
};
export const brands = [
  'volkswagen',
  'mercedes',
  'citroen',
  'peugeot',
  'renault',
  'toyota',
  'hyundai',
  'nissan',
  'skoda',
  'audi',
  'bmw',
  'fiat',
  'dacia',
  'ford',
  'honda',
  'kia',
  'opel',
  'seat',
  'tesla',
  'volvo',
];
export function vehicleBrand(model: string): string {
  const name = normalize(model);
  for (const [alias, brand] of Object.entries(aliases))
    if (name === alias || name.startsWith(alias + ' ')) return brand;
  return (
    brands.find(
      (brand) =>
        name === brand ||
        name.startsWith(brand + ' ') ||
        (brand === 'mercedes' && name.startsWith('mercedes-')),
    ) ?? 'unknown'
  );
}
