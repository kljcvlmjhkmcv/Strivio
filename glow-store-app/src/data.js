export const bundlePrice = 3200;

import wilayaSource from './wilayas.json';

export const slides = [
  { image: 'products/bundle-free-centered.png', thumbnail: 'products/bundle-free-centered.png', ar: 'باك Gabrini — فاونديشن وباودر وقلم ليب ستيك مجاني', fr: 'Pack Gabrini — fond de teint, poudre et crayon offert', kind: 'bundle' },
  { image: 'products/foundation-shades-101-104.jpg', thumbnail: 'products/foundation-shades-101-104.jpg', ar: 'درجات الفاونديشن من 101 إلى 104', fr: 'Les teintes du fond de teint, de 101 à 104', kind: 'foundation' },
  { image: 'products/powder-01-02-raised.png', thumbnail: 'products/powder-01-02-raised.png', ar: 'درجتا الباودر 01 و02', fr: 'Les teintes de poudre 01 et 02', kind: 'powder' },
  { image: 'products/lipstick-01-07-white-bg.png', thumbnail: 'products/lipstick-01-07-white-bg.png', ar: 'ألوان أقلام الليب ستيك من 01 إلى 07', fr: 'Les teintes de crayons à lèvres de 01 à 07', kind: 'lipstick' },
];

export const products = [
  {
    id: 'foundation',
    image: 'products/foundation-101.png',
    comparisonImage: 'products/foundation-shades-101-104.jpg',
    comparisonAlt: { ar: 'درجات فاونديشن Gabrini من 101 إلى 104 مع عينة لكل لون', fr: 'Échantillons des teintes 101 à 104 du fond de teint Gabrini' },
    compareLabel: { ar: 'قارني الدرجات', fr: 'Comparer les teintes' },
    title: { ar: 'فاونديشن ديرما', fr: 'Fond de teint Derma' },
    detail: { ar: 'اختاري الدرجة المناسبة لك', fr: 'Choisis ta teinte' },
    free: false,
    shades: [
      { id: '101', color: '#E9C4B2' },
      { id: '102', color: '#E6BEA8' },
      { id: '103', color: '#DDB49E' },
      { id: '104', color: '#D2A58C' },
    ],
  },
  {
    id: 'powder',
    image: 'products/powder-product.jpg',
    comparisonImage: 'products/powder-01-02-raised.png',
    comparisonAlt: { ar: 'درجتا باودر Gabrini، 01 و02', fr: 'Poudre Gabrini en teintes 01 et 02' },
    compareLabel: { ar: 'قارني الدرجات', fr: 'Comparer les teintes' },
    title: { ar: 'باودر مات', fr: 'Poudre matifiante' },
    detail: { ar: 'درجتان متوفرتان', fr: 'Deux teintes disponibles' },
    free: false,
    shades: [
      { id: '01', color: '#E7D5BE' },
      { id: '02', color: '#E5C5A2' },
    ],
  },
  {
    id: 'lipstick',
    image: 'products/lipstick-01-07-square.png',
    comparisonImage: 'products/lipstick-01-07-square.png',
    comparisonAlt: { ar: 'ألوان قلم ليب ستيك Gabrini من 01 إلى 07', fr: 'Crayons Gabrini dans les teintes 01 à 07' },
    compareLabel: { ar: 'قارني الدرجات', fr: 'Comparer les teintes' },
    title: { ar: 'ليب ستيك مخملي', fr: 'Crayon rouge à lèvres velours' },
    detail: { ar: 'هدية مع الباك — اختاري لونك', fr: 'Offert avec le pack — choisis ta teinte' },
    free: true,
    shades: [
      { id: '01', color: '#A7735A' },
      { id: '02', color: '#94665C' },
      { id: '03', color: '#955D53' },
      { id: '04', color: '#BC6164' },
      { id: '05', color: '#9C6447' },
      { id: '06', color: '#B7705A' },
      { id: '07', color: '#9C5559' },
    ],
  },
];

export const wilayas = wilayaSource
  .map(({ code, name_ar, name }) => [String(code).padStart(2, '0'), name_ar, name])
  .sort((a, b) => Number(a[0]) - Number(b[0]));
