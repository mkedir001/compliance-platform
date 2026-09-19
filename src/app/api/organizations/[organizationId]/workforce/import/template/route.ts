import{workforceCsvTemplate}from"@/domain/workforce/import-service";
export async function GET(){return new Response(workforceCsvTemplate,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":"attachment; filename=workforce-import-template.csv"}})}
