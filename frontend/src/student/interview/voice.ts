const RECORDING_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/wav',
]

export function pickSupportedAudioMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return ''
  }
  return RECORDING_MIME_CANDIDATES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? ''
}

export function extensionForAudioMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase()
  if (normalized.includes('mp4') || normalized.includes('m4a')) return 'm4a'
  if (normalized.includes('ogg')) return 'ogg'
  if (normalized.includes('wav')) return 'wav'
  return 'webm'
}

export function hasAudioInputDevice(devices: MediaDeviceInfo[]): boolean {
  return devices.some((device) => device.kind === 'audioinput')
}

export function getVoiceCaptureErrorMessage(error: unknown): string {
  const name = error instanceof DOMException
    ? error.name
    : typeof error === 'object' && error && 'name' in error
      ? String((error as { name?: unknown }).name)
      : ''

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return '没有检测到麦克风，请连接麦克风后重试，或切换到文字回答。'
  }
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return '浏览器没有麦克风权限，请在地址栏授权后重试，或切换到文字回答。'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return '麦克风暂时不可用，可能被其它软件占用，请关闭占用后重试，或切换到文字回答。'
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return '当前麦克风不满足录音要求，请更换设备后重试，或切换到文字回答。'
  }
  return '无法开始录音，请检查麦克风、浏览器权限或切换到文字回答。'
}
