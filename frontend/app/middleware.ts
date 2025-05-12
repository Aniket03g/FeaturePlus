import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  const { pathname } = request.nextUrl;
  
  // Define paths that should be accessible without authentication
  const publicPaths = ['/login', '/signup'];
  
  // Check if the path is a public path or starts with /_next/
  const isPublicPath = publicPaths.includes(pathname) || 
                      pathname.startsWith('/_next/') || 
                      pathname.startsWith('/api/');

  // If the path is not public and there is no token, redirect to login
  if (!isPublicPath && !token) {
    // Create the URL to redirect to login, preserving the original URL to redirect back after login
    const url = new URL('/login', request.url);
    url.searchParams.set('callbackUrl', encodeURI(request.url));
    
    return NextResponse.redirect(url);
  }
  
  // If we're on a login/signup page and we already have a token, redirect to homepage
  if (publicPaths.includes(pathname) && token) {
    return NextResponse.redirect(new URL('/', request.url));
  }
  
  return NextResponse.next();
}

// Configure the middleware to run on specific paths
export const config = {
  matcher: [
    /*
     * Match all paths except:
     * 1. /api routes
     * 2. /_next (Next.js internals)
     * 3. /_static (inside /public)
     * 4. /_vercel (Vercel internals)
     * 5. /favicon.ico, /robots.txt (static files)
     */
    '/((?!_next|_static|_vercel|favicon.ico|robots.txt).*)',
  ],
}; 