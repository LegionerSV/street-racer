import {clamp} from './geo';
export class NitroCharge{
  charge=1;active=false;
  private exhausted=false;
  step(dt:number,requested:boolean,eligible:boolean,paused=false){
    this.active=false;
    if(paused||!Number.isFinite(dt)||dt<=0)return 0;
    if(!requested)this.exhausted=false;
    if(requested&&eligible&&!this.exhausted&&this.charge>0){
      const amount=Math.min(this.charge,dt/4.5);
      this.charge=clamp(this.charge-amount,0,1);this.active=amount>0;
      if(this.charge<1e-8){this.charge=0;this.exhausted=true;}
      return amount/(dt/4.5);
    }
    this.charge=clamp(this.charge+dt/18,0,1);return 0;
  }
  interrupt(){this.active=false;this.exhausted=false;}
}
