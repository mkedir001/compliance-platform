export type ReferralField = { key:string; label:string; type:"text"|"date"|"email"|"tel"|"textarea"|"checkboxes"|"radio"; options?:readonly string[]; required?:boolean };
export type ReferralSection = { id:string; title:string; fields:readonly ReferralField[] };

/** Versioned from the supplied Radiant Care referral form. Sample values in completed forms are never template data. */
export const REFERRAL_TEMPLATE = {
  code:"RADIANT-REFERRAL", version:1, title:"Referral Form",
  sections:[
    {id:"source",title:"How did you hear about us?",fields:[
      {key:"referral.sources",label:"Referral source",type:"checkboxes",options:["Website","Case manager","Physician","Hospital","Previous client","Family member","Brochure","Other"]},
      {key:"referral.sourceOther",label:"Other referral source",type:"text"},{key:"referral.date",label:"Today's date",type:"date"},
    ]},
    {id:"client",title:"Client information",fields:[
      {key:"client.fullName",label:"Client name",type:"text",required:true},{key:"client.dateOfBirth",label:"Date of birth",type:"date",required:true},
      {key:"client.gender",label:"Gender",type:"radio",options:["Female","Male","Other","Prefer not to say"]},{key:"client.phone",label:"Phone",type:"tel"},
      {key:"client.bestTimeToCall",label:"Best time to call",type:"text"},{key:"client.email",label:"Email",type:"email"},
      {key:"client.serviceLocation",label:"Place services are requested",type:"radio",options:["Home","Other"]},{key:"client.serviceLocationOther",label:"Other service location",type:"text"},
      {key:"client.address",label:"Address",type:"textarea"},{key:"client.primaryDiagnosis",label:"Primary diagnosis",type:"textarea"},
    ]},
    {id:"coverage",title:"Insurance and waiver",fields:[
      {key:"coverage.types",label:"Insurance",type:"checkboxes",options:["Medicaid","Medicare","Other"]},{key:"coverage.medicaidNumber",label:"Medicaid number",type:"text"},
      {key:"coverage.medicareNumber",label:"Medicare number",type:"text"},{key:"coverage.other",label:"Other insurance",type:"text"},{key:"coverage.waiver",label:"Waiver",type:"text"},
    ]},
    {id:"services",title:"Requested services",fields:[
      {key:"services.requested",label:"Services requested (requests are not authorizations)",type:"checkboxes",options:["24-hour emergency assistance","Adult companion services","Homemaker services","Night supervision","In-home respite","Out-of-home respite","Individual community living support (ICLS)","IHS without training","IHS with training","IHS with family training","Semi-independent living services (SILS)","Employment exploration","Other"]},
      {key:"services.other",label:"Other requested service",type:"text"},{key:"services.hoursFrequency",label:"Requested hours / frequency",type:"text"},{key:"services.proposedStartDate",label:"Proposed start date",type:"date"},
    ]},
    {id:"contacts",title:"Contacts",fields:[
      {key:"contact.callPreference",label:"Who should we call?",type:"radio",options:["Client","Other"]},{key:"contact.name",label:"Family / representative contact",type:"text"},{key:"contact.relationship",label:"Relationship",type:"text"},{key:"contact.phone",label:"Contact phone",type:"tel"},
      {key:"caseManager.name",label:"Case manager name",type:"text",required:true},{key:"caseManager.phone",label:"Case manager phone",type:"tel"},{key:"caseManager.email",label:"Case manager email",type:"email"},
      {key:"referral.specialInstructions",label:"Special instructions",type:"textarea"},{key:"referrer.name",label:"Referral completed by",type:"text",required:true},{key:"referrer.agency",label:"Agency",type:"text"},{key:"referrer.phone",label:"Referrer phone",type:"tel"},{key:"referrer.email",label:"Referrer email",type:"email"},
    ]},
  ] as const satisfies readonly ReferralSection[],
};

export const REFERRAL_REQUIRED_FIELDS = REFERRAL_TEMPLATE.sections.flatMap(section=>section.fields.filter(field=>"required" in field&&field.required).map(field=>field.key));
export const REFERRAL_FIELD_KEYS = new Set<string>(REFERRAL_TEMPLATE.sections.flatMap(section=>section.fields.map(field=>field.key)));
