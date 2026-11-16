import {
  Bell,
  Bike,
  CalendarClock,
  Car,
  CircleHelp,
  CircleParking,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  Coffee,
  Compass,
  Construction,
  Croissant,
  Footprints,
  Fuel,
  MapPin,
  Megaphone,
  Mountain,
  ShoppingCart,
  ShowerHead,
  Siren,
  Sun,
  Ticket,
  TreePine,
  UserPlus,
  Users,
  Utensils,
  Wrench,
} from 'lucide-react';

// One icon family (Lucide, 2px stroke) for the whole app. Everything that
// used to be an emoji goes through the maps below so sizes, weight and
// alignment stay the same everywhere.

// Icon sitting in a line of text: sized in em and nudged onto the baseline.
export function Ico({ icon: Icon, size = '1.05em', ...rest }) {
  return <Icon className="ico" size={size} strokeWidth={2} aria-hidden="true" {...rest} />;
}

// Tinted icon tile per activity type, from the Figma design. Each colour is
// at least 3:1 on both the light and the dark card surface.
export const ACTIVITY_STYLE = {
  road_cycling: { Icon: Bike, color: '#2f8fd8' },
  gravel: { Icon: Bike, color: '#b5682f' },
  mtb: { Icon: Bike, color: '#2a7d4f' },
  running: { Icon: Footprints, color: '#d2432f' },
  trail_running: { Icon: Mountain, color: '#1f8a70' },
  hiking: { Icon: TreePine, color: '#8a6a2f' },
  other: { Icon: Compass, color: '#6f7f77' },
};
export const activityIcon = (type) => (ACTIVITY_STYLE[type] ?? ACTIVITY_STYLE.other).Icon;

export const CONDITION_ICON = { road: Construction, traffic: Car, weather: CloudRain, trail: Footprints, crowd: Users };

export const PLACE_ICON = {
  coffee: Coffee,
  food: Utensils,
  bakery: Croissant,
  bike_shop: Wrench,
  convenience: ShoppingCart,
  parking: CircleParking,
  rest_area: Fuel,
  recovery: ShowerHead,
};
export const placeIcon = (category) => PLACE_ICON[category] ?? MapPin;

export const NOTIFICATION_ICON = {
  activity_join: UserPlus,
  activity_update: CalendarClock,
  track_update: Megaphone,
  weather: CloudRain,
  nearby_event: Ticket,
  community: Users,
  sos: Siren,
};
export const notificationIcon = (type) => NOTIFICATION_ICON[type] ?? Bell;

// The weather API describes each forecast with an emoji; map those to the
// same icon family.
const WEATHER_ICON = { '☀': Sun, '🌤': CloudSun, '⛅': CloudSun, '☁': Cloud, '🌫': CloudFog, '🌦': CloudDrizzle, '🌧': CloudRain, '⛈': CloudLightning };
export function WeatherIcon({ emoji, size = 28 }) {
  const Icon = WEATHER_ICON[(emoji ?? '').replace('️', '')] ?? CircleHelp;
  return <Icon size={size} strokeWidth={1.8} aria-hidden="true" />;
}

// Severity as a coloured dot (0 good, 1 caution, 2 bad) with a text label
// for screen readers, since colour alone doesn't say it.
const SEVERITY = [
  ['good', 'Good'],
  ['warn', 'Caution'],
  ['bad', 'Bad'],
];
export function SeverityDot({ severity }) {
  const [tone, label] = SEVERITY[severity] ?? ['', 'Unknown'];
  return (
    <span className={`dot ${tone}`}>
      <span className="sr-only">{label}:</span>
    </span>
  );
}
export const severityTone = (severity) => SEVERITY[severity]?.[0] ?? '';
