"use client";

export type QuestionnaireSectionState={id:string;title:string;complete:boolean;remaining:number};

export function QuestionnaireNavigation({sections,currentId,onSelect}:{sections:QuestionnaireSectionState[];currentId:string;onSelect:(id:string)=>void}){
  const current=Math.max(0,sections.findIndex(section=>section.id===currentId)),select=(id:string)=>{onSelect(id);document.getElementById(`questionnaire-section-${id}`)?.scrollIntoView({behavior:"smooth",block:"start"})};
  return <nav className="questionnaire-navigation" aria-label="Questionnaire sections"><div className="questionnaire-section-list">{sections.map(section=><button type="button" key={section.id} className={section.id===currentId?"is-current":undefined} aria-current={section.id===currentId?"step":undefined} onClick={()=>select(section.id)}><span aria-hidden="true">{section.complete?"✓":"○"}</span><span>{section.title}<small>{section.complete?"Complete":`${section.remaining} required remaining`}</small></span></button>)}</div><div className="questionnaire-paging"><button type="button" className="secondary" disabled={current<=0} onClick={()=>select(sections[current-1].id)}>Previous section</button><span>Section {current+1} of {sections.length}</span><button type="button" className="secondary" disabled={current>=sections.length-1} onClick={()=>select(sections[current+1].id)}>Next section</button></div></nav>
}
