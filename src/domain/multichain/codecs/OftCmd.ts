import { encodePacked } from "viem";

export const SEND_MODE_TAXI = 0;

export class OftCmd {
  constructor(
    public sendMode: number,
    public passengers: string[]
  ) {}

  toBytes(): string {
    if (this.sendMode === SEND_MODE_TAXI) {
      return "0x";
    } else {
      return encodePacked(["uint8"], [this.sendMode]);
    }
  }
}
