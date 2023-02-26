import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { UpsyDeskAccessory } from './platformAccessory';
import EventSource from 'eventsource';
import { URL } from 'url';
import { PingIntroZ, UpsyDeskDeviceAccessoryContext, UpsyDeskDeviceAccessoryContextZ } from './upsy_types';

interface UpsyDeskDeviceConfig {
  host: string;
  display_name?: string;
  retryAfter?: number;
  presets?:number;
}

interface UpsyDeskPlatformConfig extends PlatformConfig {
  devices?: UpsyDeskDeviceConfig[];
  debug?: boolean;
  retryAfter?: number;
}


/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class UpsyDeskPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory<UpsyDeskDeviceAccessoryContext>[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: UpsyDeskPlatformConfig,
    public readonly api: API,
  ) {
    if (this.config.devices === undefined || !Array.isArray(this.config.devices)) {
      this.log.error(
        'You did not specify a devices array and discovery is ' +
                'unsupported! UpsyDesk will not provide any accessories',
      );
      this.config.devices = [];
    }

    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory<UpsyDeskDeviceAccessoryContext>) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevices() {

    this.config.devices?.forEach((x)=>{
      const host = 'http://'+x.host+'/events';
      const request_url = new URL(host);
      const es = new EventSource(request_url.toString());
      const log = this.log;
      es.addEventListener('ping', (e) => {
        if (e.data === '' || e.data === null) {
          log.debug('Empty ping, teardown for ', x.host);
          es.close();
          return;
        }
        // convert the data if needed
        let data = e.data;
        if (typeof data === 'string') {
          data = JSON.parse(data);
        }
        // see if it's an id message
        const ping_message_raw = PingIntroZ.safeParse(data);
        if (ping_message_raw.success) {
          const uuid = this.api.hap.uuid.generate(ping_message_raw.data.title);
          const device:UpsyDeskDeviceAccessoryContext = {
            displayName: x.display_name || ping_message_raw.data.title,
            host: x.host,
            eventsUrl:host,
            uniqueID: data.title,
            presets: x.presets,
          };
          const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
          if (existingAccessory) {
            log.info('Restoring existing accessory from cache:', existingAccessory.displayName, existingAccessory.UUID);
            if (UpsyDeskDeviceAccessoryContextZ.safeParse(existingAccessory.context).success === false) {
              this.log.debug('Cached accessory is invalid, updating', existingAccessory.context);
              existingAccessory.context = device;
              this.api.updatePlatformAccessories([existingAccessory]);
            }
            new UpsyDeskAccessory(this, existingAccessory);
          } else {
            this.log.info('Adding new accessory:', device.displayName, uuid);
            const accessory = new this.api.platformAccessory<UpsyDeskDeviceAccessoryContext>(device.displayName, uuid);
            // store a copy of the device object in the `accessory.context`
            accessory.context = device;

            // create the accessory handler for the newly create accessory
            // this is imported from `platformAccessory.ts`
            new UpsyDeskAccessory(this, accessory);

            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          }
          return;
        } else {
          log.debug(ping_message_raw.error.toString());
        }
        log.error('Unknown ping message'+JSON.stringify(e));
      });

    });
  }
}
