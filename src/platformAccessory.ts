import EventSource from 'eventsource';
import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { UpsyDeskPlatform } from './platform';
import http from 'http';
// eslint-disable-next-line max-len
import { UpsyDeskDeviceAccessoryContext, UpsyDeskStatePacketButtonZ, UpsyDeskStatePacketNumberZ, UpsyDeskStatePacketSelectZ, UpsyDeskStatePacketSensorZ } from './upsy_types';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class UpsyDeskAccessory {
  private service: Service;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private internalState = {
    Connected: false,
    CurrentHeight: 0,
    TargetHeight: 0,
    MaxHeight: 0,
    MinHeight: 0,
    HeightStep: 0,
  };

  private es: EventSource;
  private button1: Service|null = null;
  private button2: Service|null = null;
  private button3: Service|null = null;
  private button4: Service|null = null;

  constructor(
    private readonly platform: UpsyDeskPlatform,
    private readonly accessory: PlatformAccessory<UpsyDeskDeviceAccessoryContext>,
  ) {

    this.es = new EventSource(this.accessory.context.eventsUrl);

    if (this.accessory.context.presets === undefined) {
      this.accessory.context.presets = 4;
    }

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'TJHorner')
      .setCharacteristic(this.platform.Characteristic.Model, 'Upsy-Desk')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.uniqueID);

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    // eslint-disable-next-line max-len
    this.service = this.accessory.getService(this.platform.Service.Window) || this.accessory.addService(this.platform.Service.Window);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    // this.platform.log.debug('context:', accessory.context);
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.displayName);

    // create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.CurrentPosition)
      .onGet(this.handleCurrentPositionGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.PositionState)
      .onGet(this.handlePositionStateGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetPosition)
      .onGet(this.handleTargetPositionGet.bind(this))
      .onSet(this.handleTargetPositionSet.bind(this));
    /**
     * Creating multiple services of the same type.
     *
     * To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
     * when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
     * this.accessory.getService('NAME') || this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE_ID');
     *
     * The USER_DEFINED_SUBTYPE must be unique to the platform accessory (if you platform exposes multiple accessories, each accessory
     * can use the same sub type id.)
     */

    // Example: add two "motion sensor" services to the accessory
    if (this.accessory.context.presets >= 1) {
      this.button1 = this.addPresetButton(1);
    }
    if (this.accessory.context.presets >= 2) {
      this.button2 = this.addPresetButton(2);
    }
    if (this.accessory.context.presets >= 3) {
      this.button3 = this.addPresetButton(3);
    }
    if (this.accessory.context.presets >= 4) {
      this.button4 = this.addPresetButton(4);
    }

    this.es.addEventListener('state', (e) => {
      const raw_data = JSON.parse(e.data);
      if (this.platform.config.debug) {
        this.platform.log.debug('STATE:', raw_data);
      }
      this.internalState.Connected = true;
      const sensor_raw = UpsyDeskStatePacketSensorZ.safeParse(raw_data);
      if (sensor_raw.success) {
        const data = sensor_raw.data;
        if (data.id === 'sensor-upsy_desky_desk_height') {
          this.internalState.CurrentHeight = data.value;
          this.updateDeskCharacteristics();
        }
        return;
      }
      const number_raw = UpsyDeskStatePacketNumberZ.safeParse(raw_data);
      if (number_raw.success) {
        const data = number_raw.data;
        if (data.id === 'number-upsy_desky_target_desk_height') {
          this.internalState.TargetHeight = data.value;
          if (data.max_value !== undefined) {
            this.internalState.MaxHeight = data.max_value;
          }
          if (data.min_value !== undefined) {
            this.internalState.MinHeight = data.min_value;
          }
          this.updateDeskCharacteristics();
        } else if (data.id === 'number-upsy_desky_max_target_height') {
          this.internalState.MaxHeight = data.value;
          this.updateDeskCharacteristics();
        } else if (data.id === 'number-upsy_desky_min_target_height') {
          this.internalState.MinHeight = data.value;
          this.updateDeskCharacteristics();
        } else {
          this.platform.log.warn('Unhandled Number: ', data);
        }
        return;
      }
      const button_raw = UpsyDeskStatePacketButtonZ.safeParse(raw_data);
      if (button_raw.success) {
        // we currently ignore buttons
        return;
      }
      const select_raw = UpsyDeskStatePacketSelectZ.safeParse(raw_data);
      if (select_raw.success) {
        // we currently ignore select
        return;
      }
      //this.platform.log.warn('Unknown state packet', raw_data);
    });

    this.es.addEventListener('log', (e) => {
      const raw_data = JSON.parse(e.data);
      this.internalState.Connected = true;
      this.platform.log.debug('LOG:', raw_data);
    });

    this.es.addEventListener('ping', () => {
      this.internalState.Connected = true;
    });
  }

  private async updateDeskCharacteristics() {
    const target = this.calculateTargetPosition();
    if (target > 0) {
      this.service.updateCharacteristic(this.platform.Characteristic.TargetPosition, target);
    }
    const current = this.calculateCurrentPosition();
    if (current > 0) {
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentPosition, current);
    }
    const state = await this.handlePositionStateGet();
    this.service.updateCharacteristic(this.platform.Characteristic.PositionState, state);
  }

  private addPresetButton(number: string | number) {
    const name = `Upsy Desky Preset ${number}`;
    const id = `${this.accessory.context.uniqueID}-${number}`;
    const service = this.accessory.getService(name) || this.accessory.addService(this.platform.Service.Switch, name, id);
    service.setCharacteristic(this.platform.Characteristic.Name, `Preset ${number}`);
    service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.handlePresetButtonGet.bind(this, number))
      .onSet(this.handlePresetButtonSet.bind(this, number));
    return service;
  }

  private calculatePosition(CurrentHeight: number): number {
    if (this.internalState.MaxHeight === 0) {
      return -1;
    }
    if (this.internalState.MinHeight > this.internalState.MaxHeight) {
      // This is an error state
      return -1;
    }
    if (CurrentHeight < this.internalState.MinHeight) {
      return 0;
    }
    if (CurrentHeight > this.internalState.MaxHeight) {
      return 100;
    }
    const range = this.internalState.MaxHeight - this.internalState.MinHeight;
    return Math.floor(((CurrentHeight - this.internalState.MinHeight) * 100) / (range));
  }

  private calculateCurrentPosition(): number {
    return this.calculatePosition(this.internalState.CurrentHeight);
  }

  private calculateTargetPosition(): number {
    return this.calculatePosition(this.internalState.TargetHeight);
  }

  async handleCurrentPositionGet(): Promise<CharacteristicValue> {
    const height = this.calculateCurrentPosition();
    this.platform.log.info('Get Position ->', height);
    if (height < 0) {
      // if you need to return an error to show the device as "Not Responding" in the Home app:
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return height;
  }

  async handlePositionStateGet(): Promise<CharacteristicValue> {
    // if (this.internalState.CurrentHeight < this.internalState.TargetHeight) {
    //   return this.platform.Characteristic.PositionState.INCREASING;
    // }
    // if (this.internalState.CurrentHeight > this.internalState.TargetHeight) {
    //   return this.platform.Characteristic.PositionState.DECREASING;
    // }
    return this.platform.Characteristic.PositionState.STOPPED;
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  async handleTargetPositionSet(value: CharacteristicValue) {
    // implement your own code to turn your device on/off
    this.platform.log.info('Set TargetPosition ->', value);
    // TODO: make the request and let the mechanism work it's magic
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   *
   * GET requests should return as fast as possible. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   *
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  async handleTargetPositionGet(): Promise<CharacteristicValue> {
    // for now always say that it's at it's target
    const height = this.calculateCurrentPosition();

    this.platform.log.info('Get TargetPosition On ->', height);

    if (height < 0) {
      // if you need to return an error to show the device as "Not Responding" in the Home app:
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return height;
  }

  async handlePresetButtonSet(preset: number | string, value: CharacteristicValue) {
    //http://192.168.108.221/button/upsy_desky_preset_2/press
    const path = `/button/upsy_desky_preset_${preset}/press`;
    this.platform.log.info('Preset pressing ->', value, preset, path);
    // http.request({
    //   host: this.accessory.context.host,
    //   method: 'POST',
    //   path,

    // }, (res) => {
    //   this.platform.log.info('Preset pressed ->', res);
    //   if (this.button1 !== null && (preset === '1' || preset === 1)) {
    //     this.button1.updateCharacteristic(this.platform.Characteristic.On, 0);
    //   }
    //   if (this.button2 !== null && (preset === '2' || preset === 2)) {
    //     this.button2.updateCharacteristic(this.platform.Characteristic.On, 0);
    //   }
    //   if (this.button3 !== null && (preset === '3' || preset === 3)) {
    //     this.button3.updateCharacteristic(this.platform.Characteristic.On, 0);
    //   }
    //   if (this.button4 !== null && (preset === '4' || preset === 4)) {
    //     this.button4.updateCharacteristic(this.platform.Characteristic.On, 0);
    //   }
    // });

  }

  async handlePresetButtonGet(preset: number | string): Promise<CharacteristicValue> {
    this.platform.log.info('Preset get ->', preset);
    // we don't actually know what the presets are, so we just return 0
    return 0;
  }

}
