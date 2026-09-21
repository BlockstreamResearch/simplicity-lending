import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import PlayIcon from '@/components/icons/PlayIcon'

const VIDEO_SRC = '/hero-demo.mp4'
const FRAME_ASPECT = 897 / 517.279

// The screen cutout, straight from the mockup's own path data (the "Subtract"
// inner rect: x 104.346-791.16, y 33.0657-463.7). The video is placed via
// foreignObject at these exact SVG coordinates, so it lines up with the bezel
// pixel-for-pixel — no CSS percentage guessing to keep in sync.
const SCREEN_RECT = { x: 104.346, y: 33.0657, width: 791.16 - 104.346, height: 463.7 - 33.0657 }

function MockupFrame({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox='0 0 897 517.279'
      preserveAspectRatio='none'
      className='absolute inset-0 h-full w-full'
    >
      <path
        id='Subtract'
        d='M106.922 3.31868L789.326 3.31868C800.204 3.31876 809.026 12.1386 809.026 23.0189V482.658C809.026 493.538 800.204 502.358 789.326 502.358H106.922C96.042 502.358 87.2222 493.538 87.222 482.658V23.0189C87.222 12.1385 96.0419 3.31869 106.922 3.31868ZM104.346 463.7H791.16V33.0657L104.346 33.0657V463.7Z'
        fill='#F2F2F2'
        stroke='#D6D8DC'
        strokeWidth={0.697295}
      />
      <path
        id='path130'
        d='M106.93 2.97022C95.8754 2.97022 86.8816 11.964 86.8816 23.0191V482.657C86.8816 493.712 95.8754 502.706 106.93 502.706H789.334C800.39 502.706 809.383 493.712 809.383 482.657V23.0191C809.383 11.964 800.39 2.97022 789.334 2.97022H106.93ZM789.334 505.676H106.93C94.2381 505.676 83.9114 495.35 83.9114 482.657V23.0191C83.9114 10.3267 94.2381 2.3663e-05 106.93 2.3663e-05H789.334C802.024 2.3663e-05 812.353 10.3267 812.353 23.0191V482.657C812.353 495.35 802.024 505.676 789.334 505.676Z'
        fill='white'
      />
      <path
        id='path162'
        d='M897 506.691H3.14199e-07V491.106H897V506.691'
        fill='url(#hero-mockup-gradient-deck)'
      />
      <g id='path180' filter='url(#hero-mockup-filter-lip)'>
        <path
          d='M847.558 516.436C844.715 516.996 841.825 517.279 838.927 517.279L56.5076 517.279C53.5174 517.279 50.5348 516.978 47.6047 516.382L0 506.69L897 506.69L847.558 516.436Z'
          fill='#E0E0E0'
        />
      </g>
      <g id='path200' filter='url(#hero-mockup-filter-notch)'>
        <path
          d='M387.594 502.708L509.674 502.708C516.473 502.708 521.984 497.196 521.984 490.396L375.283 490.396C375.283 497.196 380.795 502.708 387.594 502.708Z'
          fill='url(#hero-mockup-gradient-notch)'
        />
      </g>
      <defs>
        <filter
          id='hero-mockup-filter-lip'
          x={0}
          y={503.901}
          width={897}
          height={13.3781}
          filterUnits='userSpaceOnUse'
          colorInterpolationFilters='sRGB'
        >
          <feFlood floodOpacity={0} result='BackgroundImageFix' />
          <feBlend mode='normal' in='SourceGraphic' in2='BackgroundImageFix' result='shape' />
          <feColorMatrix
            in='SourceAlpha'
            type='matrix'
            values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
            result='hardAlpha'
          />
          <feOffset dy={-2.78918} />
          <feGaussianBlur stdDeviation={2.78918} />
          <feComposite in2='hardAlpha' operator='arithmetic' k2={-1} k3={1} />
          <feColorMatrix
            type='matrix'
            values='0 0 0 0 0.768627 0 0 0 0 0.768627 0 0 0 0 0.768627 0 0 0 1 0'
          />
          <feBlend mode='normal' in2='shape' result='effect1_innerShadow' />
        </filter>
        <filter
          id='hero-mockup-filter-notch'
          x={375.283}
          y={489.001}
          width={146.701}
          height={15.1008}
          filterUnits='userSpaceOnUse'
          colorInterpolationFilters='sRGB'
        >
          <feFlood floodOpacity={0} result='BackgroundImageFix' />
          <feBlend mode='normal' in='SourceGraphic' in2='BackgroundImageFix' result='shape' />
          <feColorMatrix
            in='SourceAlpha'
            type='matrix'
            values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
            result='hardAlpha'
          />
          <feOffset dy={1.39459} />
          <feGaussianBlur stdDeviation={0.697295} />
          <feComposite in2='hardAlpha' operator='arithmetic' k2={-1} k3={1} />
          <feColorMatrix type='matrix' values='0 0 0 0 0.95 0 0 0 0 0.95 0 0 0 0 0.95 0 0 0 1 0' />
          <feBlend mode='normal' in2='shape' result='effect1_innerShadow' />
          <feColorMatrix
            in='SourceAlpha'
            type='matrix'
            values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
            result='hardAlpha'
          />
          <feOffset dy={-1.39459} />
          <feGaussianBlur stdDeviation={2.78918} />
          <feComposite in2='hardAlpha' operator='arithmetic' k2={-1} k3={1} />
          <feColorMatrix type='matrix' values='0 0 0 0 0.88 0 0 0 0 0.88 0 0 0 0 0.88 0 0 0 1 0' />
          <feBlend mode='normal' in2='effect1_innerShadow' result='effect2_innerShadow' />
        </filter>
        <linearGradient
          id='hero-mockup-gradient-deck'
          x1={0.000725461}
          y1={498.899}
          x2={897.001}
          y2={498.899}
          gradientUnits='userSpaceOnUse'
        >
          <stop stopColor='#E0E0E0' />
          <stop offset={0.0107527} stopColor='#F2F2F2' />
          <stop offset={0.268817} stopColor='white' />
          <stop offset={0.817204} stopColor='white' />
          <stop offset={0.989247} stopColor='#F2F2F2' />
          <stop offset={1} stopColor='#E0E0E0' />
        </linearGradient>
        <linearGradient
          id='hero-mockup-gradient-notch'
          x1={371.825}
          y1={503.465}
          x2={526.593}
          y2={503.465}
          gradientUnits='userSpaceOnUse'
        >
          <stop stopColor='#F2F2F2' />
          <stop offset={0.13176} stopColor='white' />
          <stop offset={0.868285} stopColor='white' />
          <stop offset={1} stopColor='#F2F2F2' />
        </linearGradient>
      </defs>
      <foreignObject
        x={SCREEN_RECT.x}
        y={SCREEN_RECT.y}
        width={SCREEN_RECT.width}
        height={SCREEN_RECT.height}
      >
        <div className='size-full overflow-hidden bg-black'>{children}</div>
      </foreignObject>
    </svg>
  )
}

export function HeroDemoVideo() {
  const [isOpen, setIsOpen] = useState(false)
  const [isPreviewLoaded, setIsPreviewLoaded] = useState(false)
  const previewVideoRef = useRef<HTMLVideoElement>(null)
  const openVideoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!isOpen) return

    document.body.style.overflow = 'hidden'
    openVideoRef.current?.play().catch(() => {})

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  const handleClose = () => {
    setIsOpen(false)
    const preview = previewVideoRef.current
    if (preview) {
      preview.pause()
      preview.currentTime = 0
    }
  }

  return (
    <>
      <button
        type='button'
        onClick={() => setIsOpen(true)}
        aria-label='Play product demo video'
        className='group focus-visible:status-focused relative w-full cursor-pointer outline-none'
        style={{ aspectRatio: FRAME_ASPECT }}
      >
        {!isOpen && (
          <motion.div layoutId='hero-demo-frame' className='absolute inset-0'>
            <MockupFrame>
              {}
              <video
                ref={previewVideoRef}
                src={`${VIDEO_SRC}#t=0.001`}
                muted
                playsInline
                preload='metadata'
                onLoadedData={() => setIsPreviewLoaded(true)}
                className={`h-full w-full object-contain transition-opacity duration-500 lg:object-cover ${isPreviewLoaded ? 'opacity-100' : 'opacity-0'}`}
              />
            </MockupFrame>
            <div className='absolute inset-0 flex items-center justify-center'>
              <span className='bg-surface/90 flex size-14 items-center justify-center rounded-full shadow-lg backdrop-blur-sm transition-transform group-hover:scale-105 sm:size-16'>
                <PlayIcon className='text-accent size-6' />
              </span>
            </div>
          </motion.div>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              key='backdrop'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleClose}
              className='fixed inset-0 z-50 bg-black/80 backdrop-blur-sm'
            />
            <motion.div
              key='modal'
              layoutId='hero-demo-frame'
              onClick={event => {
                if (event.target === event.currentTarget) handleClose()
              }}
              className='fixed inset-4 z-50 flex items-center justify-center sm:inset-8 lg:inset-20'
            >
              <div className='aspect-video max-h-full max-w-full overflow-hidden rounded-3xl bg-black shadow-2xl'>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption -- captions are burned into the video by Zubtitle; no separate track file exists */}
                <video
                  ref={openVideoRef}
                  src={VIDEO_SRC}
                  controls
                  playsInline
                  className='h-full w-full object-cover'
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
