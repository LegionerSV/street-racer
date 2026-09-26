import type { VehicleModelId } from './vehicle-profiles';
import type { VehicleBodyShape } from './vehicle-body-shape';
import { body as b0 } from './vehicle-bodies/sport-coupe';
import { body as b1 } from './vehicle-bodies/city-sedan';
import { body as b2 } from './vehicle-bodies/stream-sedan';
import { body as b3 } from './vehicle-bodies/classic-sedan';
import { body as b4 } from './vehicle-bodies/urban-hatch';
import { body as b5 } from './vehicle-bodies/long-liftback';
import { body as b6 } from './vehicle-bodies/executive-sedan';
import { body as b7 } from './vehicle-bodies/trail-suv';
import { body as b8 } from './vehicle-bodies/angular-suv';
import { body as b9 } from './vehicle-bodies/square-suv';
import { body as b10 } from './vehicle-bodies/compact-suv';
import { body as b11 } from './vehicle-bodies/budget-sedan';
import { body as b12 } from './vehicle-bodies/utility-suv';
import { body as b13 } from './vehicle-bodies/touring-suv';
import { body as b14 } from './vehicle-bodies/short-suv';
import { body as b15 } from './vehicle-bodies/family-wagon';
import { body as b16 } from './vehicle-bodies/domestic-sedan';
import { body as b17 } from './vehicle-bodies/metro-suv';
import { body as b18 } from './vehicle-bodies/coupe-suv';
import { body as b19 } from './vehicle-bodies/delivery-van';
import { body as b20 } from './vehicle-bodies/small-truck';
import { body as b21 } from './vehicle-bodies/box-truck';
export const VEHICLE_BODIES: Record<VehicleModelId, VehicleBodyShape> = {
  'sport-coupe': b0,
  'city-sedan': b1,
  'stream-sedan': b2,
  'classic-sedan': b3,
  'urban-hatch': b4,
  'long-liftback': b5,
  'executive-sedan': b6,
  'trail-suv': b7,
  'angular-suv': b8,
  'square-suv': b9,
  'compact-suv': b10,
  'budget-sedan': b11,
  'utility-suv': b12,
  'touring-suv': b13,
  'short-suv': b14,
  'family-wagon': b15,
  'domestic-sedan': b16,
  'metro-suv': b17,
  'coupe-suv': b18,
  'delivery-van': b19,
  'small-truck': b20,
  'box-truck': b21,
};
