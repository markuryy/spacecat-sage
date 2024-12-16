export interface FileInfo {
    name: string
    path: string
    size: number
    hasCaption?: boolean
  }
  
  export interface CaptionResult {
    caption?: string
    error?: string
    image_name?: string
    status?: string
  }
  
  export function isValidCaptionResult(result: unknown): result is CaptionResult {
    return (
      typeof result === 'object' &&
      result !== null &&
      (
        (typeof (result as CaptionResult).caption === 'string' || (result as CaptionResult).caption === undefined) &&
        (typeof (result as CaptionResult).error === 'string' || (result as CaptionResult).error === undefined) &&
        (typeof (result as CaptionResult).image_name === 'string' || (result as CaptionResult).image_name === undefined) &&
        (typeof (result as CaptionResult).status === 'string' || (result as CaptionResult).status === undefined)
      )
    );
  }