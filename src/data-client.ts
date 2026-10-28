export interface DataEntry {
  name: string
  type: "file" | "directory"
  size?: number
  modified?: number
}

export interface DataDirectoryResponse {
  type: "directory"
  path: string
  entries: DataEntry[]
}

export interface DataFileResponse {
  type: "file"
  name: string
  size: number
  modified: number
  download_url: string
}

export interface CreateDirectoryResponse {
  type: string
  name: string
  path: string
}

export interface ApiErrorResponse {
  detail: string
  code?: string
}

export interface UploadOptions {
  overwrite?: boolean
  onProgress?: (loaded: number, total: number) => void
  signal?: AbortSignal
}

export interface ResumableUploadOptions extends UploadOptions {
  chunkSize?: number
  resumeUploadId?: string
}

interface ResumableInitResponse {
  upload_id: string
  chunk_size: number
}

async function parseErrorResponse(response: Response): Promise<ApiErrorResponse> {
  try {
    return await response.json()
  } catch {
    const text = await response.text()
    return { detail: text || `HTTP ${response.status}` }
  }
}

function throwApiError(detail: string, code?: string): never {
  throw Object.assign(new Error(detail), { code })
}

/**
 * Data CRUD API client.
 *
 * `basePath` identifies the data root to operate on. Different scopes
 * (graph/VNF/editor) are selected by basePath, not by subclassing.
 * Use the factory helpers (`graphDataClient`, etc.) for common cases.
 *
 * Example basePath: "/node-flow/graphs/myflow/data"
 */
export class DataClient {
  static readonly RESUMABLE_THRESHOLD = 10 * 1024 * 1024
  static readonly DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024

  readonly engineGatewayUrl: string
  readonly basePath: string

  constructor(engineGatewayUrl: string, basePath: string) {
    this.engineGatewayUrl = engineGatewayUrl
    this.basePath = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath
  }

  private buildUrl(path: string, raw?: boolean): string {
    const base = `http://${this.engineGatewayUrl}${this.basePath}/`
    if (!path) {
      return raw ? `${base}?raw` : base
    }
    const encoded = path.split("/").map(encodeURIComponent).join("/")
    const url = `${base}${encoded}`
    return raw ? `${url}?raw` : url
  }

  async fetchPath(
    path: string,
  ): Promise<DataDirectoryResponse | DataFileResponse> {
    const response = await fetch(this.buildUrl(path))
    if (!response.ok) {
      const text = await response.text()
      throw new Error(text || `HTTP ${response.status}`)
    }
    return response.json()
  }

  async fetchFileRaw(
    filePath: string,
  ): Promise<{ text: string; blob: Blob }> {
    const response = await fetch(this.buildUrl(filePath, true))
    if (!response.ok) {
      const text = await response.text()
      throw new Error(text || `HTTP ${response.status}`)
    }
    const blob = await response.blob()
    const text = await blob.text()
    return { text, blob }
  }

  async deletePath(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    let url = this.buildUrl(path)
    if (options?.recursive) {
      url += (url.includes("?") ? "&" : "?") + "recursive=true"
    }
    const response = await fetch(url, { method: "DELETE" })
    if (!response.ok) {
      const err = await parseErrorResponse(response)
      throwApiError(err.detail, err.code)
    }
  }

  async createDirectory(path: string): Promise<CreateDirectoryResponse> {
    const url = this.buildUrl(path) + "?type=directory"
    const response = await fetch(url, { method: "PUT" })
    if (!response.ok) {
      const err = await parseErrorResponse(response)
      throwApiError(err.detail, err.code)
    }
    return response.json()
  }

  uploadFile(
    path: string,
    file: File,
    options?: UploadOptions,
  ): Promise<DataFileResponse> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      let url = this.buildUrl(path)
      if (options?.overwrite) {
        url += (url.includes("?") ? "&" : "?") + "overwrite=true"
      }
      xhr.open("PUT", url)

      if (options?.signal) {
        options.signal.addEventListener("abort", () => xhr.abort())
      }

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && options?.onProgress) {
          options.onProgress(e.loaded, e.total)
        }
      })

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText))
        } else {
          try {
            const err = JSON.parse(xhr.responseText) as ApiErrorResponse
            reject(Object.assign(new Error(err.detail), { code: err.code }))
          } catch {
            reject(new Error(xhr.responseText || `HTTP ${xhr.status}`))
          }
        }
      })

      xhr.addEventListener("error", () => reject(new Error("Network error")))
      xhr.addEventListener("abort", () => reject(new Error("Upload aborted")))

      const formData = new FormData()
      formData.append("file", file)
      xhr.send(formData)
    })
  }

  async uploadFileResumable(
    path: string,
    file: File,
    options?: ResumableUploadOptions,
  ): Promise<DataFileResponse> {
    const chunkSize = options?.chunkSize ?? DataClient.DEFAULT_CHUNK_SIZE
    let uploadId = options?.resumeUploadId ?? ""
    let offset = 0

    if (uploadId) {
      offset = await this.getUploadOffset(path, uploadId)
      if (offset === 0) uploadId = ""
    }

    if (!uploadId) {
      const init = await this.initResumableUpload(
        path,
        file.size,
        options?.overwrite ?? false,
      )
      uploadId = init.upload_id
    }

    while (offset < file.size) {
      if (options?.signal?.aborted) throw new Error("Upload aborted")
      const end = Math.min(offset + chunkSize, file.size)
      const chunk = await file.slice(offset, end).arrayBuffer()
      const result = await this.sendChunk(
        path,
        uploadId,
        offset,
        chunk,
        options?.signal,
      )
      offset = result.received_offset
      options?.onProgress?.(offset, file.size)
    }

    return this.completeResumableUpload(path, uploadId)
  }

  private async initResumableUpload(
    path: string,
    size: number,
    overwrite: boolean,
  ): Promise<ResumableInitResponse> {
    let url = this.buildUrl(path) + "?upload=init"
    if (overwrite) url += "&overwrite=true"
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ size }),
    })
    if (!response.ok) {
      const err = await parseErrorResponse(response)
      throwApiError(err.detail, err.code)
    }
    return response.json()
  }

  private async sendChunk(
    path: string,
    uploadId: string,
    offset: number,
    chunk: ArrayBuffer,
    signal?: AbortSignal,
  ): Promise<{ received_offset: number }> {
    const url =
      this.buildUrl(path) +
      `?upload_id=${encodeURIComponent(uploadId)}&offset=${offset}`
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: chunk,
      signal,
    })
    if (!response.ok) {
      const err = await parseErrorResponse(response)
      throwApiError(err.detail, err.code)
    }
    return response.json()
  }

  private async completeResumableUpload(
    path: string,
    uploadId: string,
  ): Promise<DataFileResponse> {
    const url =
      this.buildUrl(path) +
      `?upload_id=${encodeURIComponent(uploadId)}&upload=complete`
    const response = await fetch(url, { method: "POST" })
    if (!response.ok) {
      const err = await parseErrorResponse(response)
      throwApiError(err.detail, err.code)
    }
    return response.json()
  }

  private async getUploadOffset(
    path: string,
    uploadId: string,
  ): Promise<number> {
    const url =
      this.buildUrl(path) + `?upload_id=${encodeURIComponent(uploadId)}`
    const response = await fetch(url, { method: "HEAD" })
    if (!response.ok) return 0
    return Number(response.headers.get("X-Upload-Offset") ?? "0")
  }
}

// -- Factory helpers --

export function graphDataClient(
  engineGatewayUrl: string,
  graphName: string,
): DataClient {
  return new DataClient(
    engineGatewayUrl,
    `/node-flow/graphs/${encodeURIComponent(graphName)}/data`,
  )
}
