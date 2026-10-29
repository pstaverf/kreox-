export interface MessagePhoto {
  _id: string;
  attachment: string;
}
export interface MessagePhotoCache {
  messagePhoto(key: string): Promise<string | null>;
  saveMessagePhoto(key: string, attachment: string): Promise<void>;
}
export type RoulettePhotoResolver = (peerId: number, result: number) => Promise<string | null>;

export type MessagePhotoResolver = (peerId: number, url: string) => Promise<string | null>;
