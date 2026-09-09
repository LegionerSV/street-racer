import { useId } from 'react';
import { racerTraitWords } from './racing-ai';
import type { RacerTraits } from './types';

export function RacerClover({traits,size=42}:{traits:RacerTraits;size?:number}){
  const id=useId().replaceAll(':',''),values=[traits.accuracy,traits.aggression,traits.reaction],colours=['#8de8ff','#ff6655','#d8ff3e'],labels=['Точность','Агрессия','Реакция'],words=racerTraitWords(traits);
  return <svg className="racer-clover" width={size} height={size} viewBox="0 0 60 60" aria-label={labels.map((label,i)=>`${label} ${Math.round(values[i]*100)}% — ${words[i].toLowerCase()}`).join(', ')}>
    <title>{labels.map((label,i)=>`${label} ${Math.round(values[i]*100)}% — ${words[i].toLowerCase()}`).join(' · ')}</title>
    {values.map((value,i)=><g key={labels[i]} transform={`rotate(${i*120} 30 30)`}>
      <path className="clover-petal" d="M30 29C16 25 13 14 18 7C23 0 37 0 42 7C47 14 44 25 30 29Z"/>
      <clipPath id={`${id}-${i}`}><rect x="10" y={29-27*value} width="40" height={27*value}/></clipPath>
      <path className="clover-petal-fill" clipPath={`url(#${id}-${i})`} fill={colours[i]} d="M30 29C16 25 13 14 18 7C23 0 37 0 42 7C47 14 44 25 30 29Z"/>
    </g>)}
    <circle cx="30" cy="30" r="4" fill="#d7e0df"/>
  </svg>;
}
