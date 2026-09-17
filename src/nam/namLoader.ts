export type NamArchitecture="A1"|"A2"|"UNKNOWN";
export type NamMetadata={architecture:NamArchitecture;name?:string;sampleRate?:number;raw:unknown};
export function detectArchitecture(raw:any):NamArchitecture{const v=String(raw?.architecture??raw?.model?.architecture??"").toUpperCase();if(v.includes("A2")||v==="2")return"A2";if(v.includes("A1")||v==="1")return"A1";return"UNKNOWN"}
export async function parseNamFile(file:File):Promise<NamMetadata>{const raw=JSON.parse(await file.text());return{architecture:detectArchitecture(raw),name:raw?.name??raw?.metadata?.name,sampleRate:raw?.sample_rate??raw?.metadata?.sample_rate,raw}}
export function validateNamMetadata(m:NamMetadata){return m.architecture==="UNKNOWN"?["NAM architecture could not be determined."]:[]}