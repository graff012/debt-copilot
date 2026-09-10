import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest): NextResponse {
  const hasSession = req.cookies.has('access');
  const { pathname } = req.nextUrl;
  if (!hasSession && pathname !== '/login') {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  if (hasSession && pathname === '/login') {
    return NextResponse.redirect(new URL('/', req.url));
  }
  return NextResponse.next();
}

export const config = {
  // Pages only: /api/* route handlers manage their own auth.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
