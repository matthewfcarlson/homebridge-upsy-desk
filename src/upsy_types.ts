import {z} from 'zod';


// the first ping contains some helful data
export const PingIntroZ = z.object({
  title:z.string().startsWith('upsy'),
  comment:z.string().optional(),
  ota:z.boolean(),
  lang: z.string(),
});

export const UpsyDeskDeviceAccessoryContextZ = z.object({
  displayName: z.string(),
  host: z.string(),
  eventsUrl: z.string().url(),
  uniqueID:z.string(),
  presets:z.number().optional(),
}).passthrough();
export type UpsyDeskDeviceAccessoryContext = z.infer<typeof UpsyDeskDeviceAccessoryContextZ>;

export const UpsyDeskStatePacketNumberZ = z.object({
  id: z.string().startsWith('number-'),
  value: z.number(),
  state: z.string(),
  min_value: z.number().optional(),
  max_value: z.number().optional(),
  step: z.number().optional(),
});

export const UpsyDeskStatePacketButtonZ = z.object({
  id: z.string().startsWith('button-'),
  name: z.number().optional(),
});

export const UpsyDeskStatePacketSelectZ = z.object({
  id: z.string().startsWith('select-'),
  name: z.number().optional(),
});

export const UpsyDeskStatePacketSensorZ = z.object({
  id: z.string().startsWith('sensor-'),
  name: z.string().optional(),
  value: z.number(),
  state: z.string().optional(),
});