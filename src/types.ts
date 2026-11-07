export interface Subtitle {
  lang: string
  label: string
  src: string
}

export interface Movie {
  id: string
  title: string
  year: number
  duration: number
  category: string
  rating: string
  synopsis: string
  poster: string
  backdrop: string
  stream: string
  type: 'hls' | 'mp4'
  license: string
  source: string
  subtitles?: Subtitle[]
  draft?: boolean
}

export interface Category {
  id: string
  name: string
}

export interface Catalog {
  version: number
  categories: Category[]
  movies: Movie[]
}

export type View =
  | { name: 'home' }
  | { name: 'details'; movie: Movie }
  | { name: 'player'; movie: Movie }
  | { name: 'downloads' }
