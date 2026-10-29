import { useEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger, useGSAP);

export function useSmoothPage() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const lenis = new Lenis({ anchors: true, lerp: 0.085, smoothWheel: true });
    const updateScroll = () => ScrollTrigger.update();
    const raf = (time) => lenis.raf(time * 1000);
    lenis.on('scroll', updateScroll);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    return () => {
      lenis.off('scroll', updateScroll);
      gsap.ticker.remove(raf);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.destroy();
    };
  }, []);
}

export function usePageReveals(scope) {
  useGSAP(() => {
    const motion = gsap.matchMedia();
    motion.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from('[data-hero-enter]', {
        y: 24, autoAlpha: 0, duration: 0.72, stagger: 0.11,
        ease: 'power2.out', clearProps: 'all',
      });
      gsap.utils.toArray('[data-reveal]').forEach((element) => {
        gsap.from(element, {
          y: 28, autoAlpha: 0, duration: 0.68, ease: 'power2.out',
          scrollTrigger: { trigger: element, start: 'top 88%', once: true },
        });
      });
      const ambientCopy = scope.current?.querySelectorAll('.hero h1, .hero-price strong') ?? [];
      gsap.to(ambientCopy, {
        y: -2.5, duration: 2.6, stagger: 0.3, ease: 'sine.inOut',
        repeat: -1, yoyo: true, repeatDelay: 0.35, delay: 1.6,
      });
      const trail = scope.current?.querySelector('.sparkle-trail');
      const cleanups = [];
      if (trail) {
        let trailScroll;
        const trailIntro = gsap.fromTo(trail,
          { y: -13, autoAlpha: 0 },
          {
            y: 0, autoAlpha: 1, duration: 0.9, delay: 0.12, ease: 'power2.out',
            onComplete: () => {
              trailScroll = ScrollTrigger.create({
                trigger: scope.current?.querySelector('.hero'),
                start: 'top top-=70', end: 'top top-=235', scrub: 0.7,
                onUpdate: (self) => gsap.set(trail, { autoAlpha: 1 - self.progress, y: -20 * self.progress }),
              });
            },
          },
        );
        cleanups.push(() => {
          trailIntro.kill();
          trailScroll?.kill();
          gsap.set(trail, { clearProps: 'all' });
        });
      }
      const microButtons = scope.current?.querySelectorAll('.button, .nav-order, .mobile-order-bar button, .shade-option, .shade-compare-button, .carousel-thumb') ?? [];
      microButtons.forEach((element) => {
        const enter = () => gsap.to(element, { scale: 1.035, y: -2, duration: 0.18, ease: 'power2.out', overwrite: 'auto' });
        const leave = () => gsap.to(element, { scale: 1, y: 0, duration: 0.22, ease: 'power2.out', overwrite: 'auto' });
        const down = () => gsap.to(element, { scale: 0.97, duration: 0.08, ease: 'power1.out', overwrite: 'auto' });
        element.addEventListener('pointerenter', enter);
        element.addEventListener('pointerleave', leave);
        element.addEventListener('pointerdown', down);
        element.addEventListener('pointerup', enter);
        cleanups.push(() => {
          element.removeEventListener('pointerenter', enter);
          element.removeEventListener('pointerleave', leave);
          element.removeEventListener('pointerdown', down);
          element.removeEventListener('pointerup', enter);
          gsap.killTweensOf(element);
        });
      });
      return () => cleanups.forEach((cleanup) => cleanup());
    });
    return () => motion.revert();
  }, { scope });
}

export function useCarouselTransition(scope, slideIndex, isArabic) {
  useGSAP(() => {
    if (!scope.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.fromTo(scope.current.querySelector('.carousel-image'),
      { autoAlpha: 0.55, scale: 0.98, x: isArabic ? 10 : -10 },
      { autoAlpha: 1, scale: 1, x: 0, duration: 0.22, ease: 'power2.out', clearProps: 'transform' },
    );
  }, { scope, dependencies: [slideIndex], revertOnUpdate: true });
}
