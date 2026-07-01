import {
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
  useUser,
} from "@clerk/clerk-react";

const ClerkAuth = () => {
  const { user } = useUser();
  return (
    <div className="flex items-center gap-4">
      <SignedOut>
        <div className="transition-all hover:scale-105 active:scale-95">
          <SignInButton mode="modal">
            <button className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 rounded-full hover:bg-indigo-700 transition-colors shadow-md hover:shadow-lg active:shadow-sm">
              Sign In
            </button>
          </SignInButton>
        </div>
      </SignedOut>

      <SignedIn>
        <div className="flex items-center gap-3 bg-gray-50/50 pl-4 pr-2 py-1.5 rounded-full border border-gray-100 hover:border-indigo-100 transition-all hover:shadow-sm">
          <span className="text-sm font-medium text-gray-700 hidden sm:inline-block">
            {user?.firstName || user?.username}
          </span>
          <UserButton
            appearance={{
              elements: {
                userButtonAvatarBox:
                  "w-8 h-8 border border-white shadow-sm hover:shadow-md transition-all",
                userButtonTrigger:
                  "hover:scale-105 active:scale-95 transition-all outline-none",
              },
            }}
            afterSignOutUrl="/"
          />
        </div>
      </SignedIn>
    </div>
    // </Navbar>
  );
};

export default ClerkAuth;
