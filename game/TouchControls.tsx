'use client';
import {useEffect,useRef,useState,type ReactNode,type PointerEvent} from 'react';
import {ArrowLeft,ArrowRight,ChevronUp,Zap,RotateCcw} from 'lucide-react';
import type {DrivingKey} from './input';
type Input=(pointerId:number,key:DrivingKey,down:boolean)=>void;
function HeldButton({code,label,className='',children,onInput}:{code:DrivingKey;label:string;className?:string;children:ReactNode;onInput:Input}){
  const pointers=useRef(new Set<number>()),[held,setHeld]=useState(false);
  const keyboardId=-(['KeyA','KeyD','KeyW','KeyS','Space','ShiftLeft'].indexOf(code)+1);
  useEffect(()=>{const owned=pointers.current;return()=>{for(const id of owned)onInput(id,code,false);owned.clear();};},[code,onInput]);
  const down=(id:number)=>{pointers.current.add(id);onInput(id,code,true);setHeld(true);};
  const up=(id:number)=>{if(!pointers.current.delete(id))return;onInput(id,code,false);setHeld(pointers.current.size>0);};
  const release=(e:PointerEvent<HTMLButtonElement>)=>{e.preventDefault();up(e.pointerId);};
  return <button type="button" className={'touch-key '+className} aria-label={label} aria-pressed={held} data-pressed={held}
    onContextMenu={e=>e.preventDefault()} onBlur={()=>up(keyboardId)}
    onPointerDown={e=>{if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();try{e.currentTarget.setPointerCapture(e.pointerId);}catch{return;}down(e.pointerId);}}
    onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
    onKeyDown={e=>{if(e.code==='Space'||e.code==='Enter'){e.preventDefault();e.stopPropagation();if(!e.repeat)down(keyboardId);}}}
    onKeyUp={e=>{if(e.code==='Space'||e.code==='Enter'){e.preventDefault();e.stopPropagation();up(keyboardId);}}}>
    {children}
  </button>;
}
export function TouchControls({onInput,onRecover,nitro}:{onInput:Input;onRecover:()=>void;nitro:number}){
  return <fieldset className="touch-controls" aria-label="Сенсорное управление">
    <div className="touch-steering">
      <HeldButton code="KeyA" label="Повернуть налево" onInput={onInput}><ArrowLeft size={32}/></HeldButton>
      <HeldButton code="KeyD" label="Повернуть направо" onInput={onInput}><ArrowRight size={32}/></HeldButton>
    </div>
    <div className="touch-pedals">
      <HeldButton code="Space" label="Ручник" className="touch-handbrake" onInput={onInput}><span>РУЧНИК</span></HeldButton>
      <HeldButton code="ShiftLeft" label="Нитро" className="touch-nitro" onInput={onInput}><Zap size={21}/><span>НИТРО {Math.round(nitro*100)}%</span></HeldButton>
      <HeldButton code="KeyS" label="Тормоз и задний ход" className="touch-brake" onInput={onInput}><span>ТОРМОЗ<br/>/ НАЗАД</span></HeldButton>
      <HeldButton code="KeyW" label="Газ" className="touch-gas" onInput={onInput}><ChevronUp size={30}/><span>ГАЗ</span></HeldButton>
    </div>
    <button type="button" className="touch-recover" onClick={onRecover} aria-label="Вернуться на дорогу"><RotateCcw size={19}/><span>НА ДОРОГУ</span></button>
    <span className="rotate-hint">Удобнее играть, повернув телефон горизонтально</span>
  </fieldset>;
}
