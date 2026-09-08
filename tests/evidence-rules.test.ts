import {describe,expect,it}from"vitest";import{determineCompetencyResult}from"@/domain/evidence/service";
const rules=[{id:"required",required:true,criticalFailure:false},{id:"critical",required:true,criticalFailure:true}];
describe("competency final result derivation",()=>{
 it("passes only when every required item passes",()=>expect(determineCompetencyResult(rules,new Map([["required","PASS"],["critical","PASS"]]))).toBe("PASS"));
 it("does not pass an unobserved required item",()=>expect(determineCompetencyResult(rules,new Map([["required","NOT_OBSERVED"],["critical","PASS"]]))).toBe("REMEDIATION_REQUIRED"));
 it("fails a critical failure deterministically",()=>expect(determineCompetencyResult(rules,new Map([["required","PASS"],["critical","FAIL"]]))).toBe("FAIL"));
 it("ignores a client-proposed aggregate result by deriving from items",()=>expect(determineCompetencyResult(rules,new Map([["required","FAIL"],["critical","PASS"]]))).not.toBe("PASS"));
 it("cannot finalize a checklist with no rules as passing",()=>expect(determineCompetencyResult([],new Map())).toBe("INCOMPLETE"));
});
