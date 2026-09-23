import { buttonVariants, Chip, Drawer } from '@heroui/react'
import type { CSSProperties } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import ArrowRightIcon from '@/components/icons/ArrowRightIcon'
import ArrowSquareOutIcon from '@/components/icons/ArrowSquareOutIcon'
import MenuIcon from '@/components/icons/MenuIcon'
import { env } from '@/constants/env'
import { RoutePath } from '@/constants/routes'

const ABOUT_SIMPLICITY_URL = 'https://simplicity-lang.org/'
const FAUCET_URL = 'https://liquidtestnet.com/faucet'
const SCROLL_ENTER_THRESHOLD = 40
const SCROLL_EXIT_THRESHOLD = 12

const MENU_LINKS = [
  { label: 'About Simplicity', href: ABOUT_SIMPLICITY_URL },
  { label: 'Docs', href: 'https://docs.simplicity-lang.org/' },
  { label: 'GitHub', href: 'https://github.com/BlockstreamResearch/simplicity-lending)' },
  {
    label: 'Community',
    href: 'https://community.simplicity-lang.org/c/share-your-projects/simplicity-lending-protocol/12',
  },
]

export function LandingHeader() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const closeMenu = () => setIsMenuOpen(false)

  const menuLinks = useMemo(
    () =>
      env.VITE_NETWORK === 'liquidtestnet'
        ? [...MENU_LINKS, { label: 'Get test funds', href: FAUCET_URL }]
        : MENU_LINKS,
    [],
  )

  useEffect(() => {
    let ticking = false

    const updateScrolled = () => {
      setIsScrolled(prevScrolled => {
        const scrollY = window.scrollY
        return prevScrolled ? scrollY > SCROLL_EXIT_THRESHOLD : scrollY > SCROLL_ENTER_THRESHOLD
      })
      ticking = false
    }

    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(updateScrolled)
    }

    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`bg-surface z-sticky sticky top-0 w-full transition-[padding,box-shadow] duration-300 ease-out ${
        isScrolled ? 'py-3 shadow-sm' : 'py-6 shadow-none lg:py-10'
      }`}
    >
      <div className='mx-auto flex w-full max-w-7xl flex-col gap-1.5 px-4 sm:px-8 lg:px-20'>
        <div className='flex items-center justify-between gap-4'>
          <Link
            to={RoutePath.Landing}
            className={`flex origin-left flex-col gap-2 transition-transform duration-300 ease-out ${
              isScrolled ? 'scale-75' : 'scale-100'
            }`}
          >
            <div className='flex items-center gap-2'>
              <h1 className='text-3xl leading-none font-black tracking-tight uppercase sm:text-4xl lg:text-[43px] lg:leading-10'>
                Lending
              </h1>
              <Chip color='accent' variant='primary' size='sm'>
                Beta
              </Chip>
            </div>
            <span className='text-foreground text-xs font-medium tracking-[0.12em] uppercase whitespace-nowrap sm:tracking-[0.16em]'>
              powered by Simplicity
            </span>
          </Link>

          <div className='flex items-center gap-2 sm:gap-3'>
            <a
              className={`${buttonVariants({ variant: 'ghost' })} hidden sm:inline-flex`}
              href={ABOUT_SIMPLICITY_URL}
              target='_blank'
              rel='noopener noreferrer'
            >
              About Simplicity
              <ArrowSquareOutIcon className='size-4' />
            </a>
            {env.VITE_NETWORK === 'liquidtestnet' && (
              <a
                className={`${buttonVariants({ variant: 'outline' })} hidden sm:inline-flex`}
                style={
                  {
                    borderColor: 'var(--accent)',
                    '--button-fg': 'var(--accent)',
                    '--button-bg-hover': 'var(--accent-soft)',
                    '--button-bg-pressed': 'var(--accent-soft-hover)',
                  } as CSSProperties
                }
                href={FAUCET_URL}
                target='_blank'
                rel='noopener noreferrer'
              >
                Get test funds
                <ArrowSquareOutIcon className='size-4' />
              </a>
            )}

            <Drawer.Root isOpen={isMenuOpen} onOpenChange={setIsMenuOpen}>
              <Drawer.Trigger
                aria-label='Menu'
                className={`${buttonVariants({ variant: 'ghost', isIconOnly: true })} sm:hidden`}
              >
                <span className='flex size-full items-center justify-center'>
                  <MenuIcon className='size-5' />
                </span>
              </Drawer.Trigger>
              <Drawer.Backdrop className='z-modal' variant='opaque'>
                <Drawer.Content placement='bottom' className='z-modal'>
                  <Drawer.Dialog className='overflow-hidden pb-[calc(1.5rem+env(safe-area-inset-bottom))]'>
                    <Drawer.Handle />
                    <Drawer.Heading className='sr-only'>Menu</Drawer.Heading>
                    <Drawer.Body className='overflow-x-hidden'>
                      <nav className='divide-border -mx-6 flex flex-col divide-y'>
                        {menuLinks.map(({ label, href }) => (
                          <a
                            key={label}
                            className='hover:bg-default active:bg-default text-foreground flex items-center justify-between px-6 py-4 text-base font-medium transition-colors'
                            href={href}
                            target='_blank'
                            rel='noopener noreferrer'
                            onClick={closeMenu}
                          >
                            {label}
                            <ArrowSquareOutIcon className='text-muted size-4 shrink-0' />
                          </a>
                        ))}
                      </nav>
                    </Drawer.Body>
                    <Drawer.Footer className='flex-col items-stretch'>
                      <Link
                        to={RoutePath.Dashboard}
                        className={buttonVariants({
                          variant: 'primary',
                          size: 'lg',
                          fullWidth: true,
                        })}
                        onClick={closeMenu}
                      >
                        Launch App
                        <ArrowRightIcon className='size-4' />
                      </Link>
                    </Drawer.Footer>
                  </Drawer.Dialog>
                </Drawer.Content>
              </Drawer.Backdrop>
            </Drawer.Root>

            <Link
              to={RoutePath.Dashboard}
              className={`${buttonVariants({ variant: 'primary' })} hidden sm:inline-flex`}
            >
              Launch App
            </Link>
          </div>
        </div>
      </div>
    </header>
  )
}
