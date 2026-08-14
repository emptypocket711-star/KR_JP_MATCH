import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/onboarding/presentation/onboarding_screen.dart';
import '../../features/discovery/presentation/discovery_screen.dart';
import '../../features/matches/presentation/chats_list_screen.dart';
import '../../features/chat/presentation/chat_screen.dart';
import '../../features/profile/presentation/profile_edit_screen.dart';
import '../../features/profile/presentation/profile_detail_screen.dart';
import '../../features/lounge/presentation/lounge_screen.dart';
import '../../features/lounge/presentation/lounge_compose_screen.dart';
import '../../features/lounge/presentation/lounge_detail_screen.dart';
import '../../features/settings/presentation/settings_screen.dart';
import '../../features/settings/presentation/blocked_users_screen.dart';
import '../../features/splash/presentation/splash_screen.dart';
import '../../features/auth/presentation/auth_provider.dart';
import '../../features/paywall/presentation/paywall_screen.dart';

@visibleForTesting
const legacyMainTabRedirects = <String, String>{
  '/matches': '/chats',
  '/profile': '/settings',
};

@visibleForTesting
String? profileAccessRedirect({
  required ProfileAccessState accessState,
  required String location,
}) {
  switch (accessState) {
    case ProfileAccessState.loading:
      return location == '/splash' ? null : '/splash';
    case ProfileAccessState.incomplete:
      return location == '/onboarding' ? null : '/onboarding';
    case ProfileAccessState.remediation:
      // A completed legacy profile must use updateMyProfile: completeOnboarding
      // can reject profiles that are usable but still miss newer public fields.
      // Settings stays reachable so the user can safely log out or switch
      // accounts without gaining access to protected app surfaces.
      return location == '/profile/edit' || location == '/settings'
          ? null
          : '/profile/edit';
    case ProfileAccessState.active:
      if (location == '/splash' ||
          location == '/login' ||
          location == '/onboarding' ||
          location == '/account-disabled' ||
          location == '/profile-access-error' ||
          location == '/') {
        return '/discovery';
      }
      return null;
    case ProfileAccessState.disabled:
      return location == '/account-disabled' ? null : '/account-disabled';
    case ProfileAccessState.error:
      return location == '/profile-access-error'
          ? null
          : '/profile-access-error';
  }
}

class _AuthChangeNotifier extends ChangeNotifier {
  _AuthChangeNotifier(Ref ref) {
    ref.listen(authStateProvider, (_, __) => notifyListeners());
    ref.listen(profileAccessProvider, (_, __) => notifyListeners());
  }
}

final appRouterProvider = Provider<GoRouter>((ref) {
  final notifier = _AuthChangeNotifier(ref);

  final router = GoRouter(
    initialLocation: '/splash',
    refreshListenable: notifier,
    redirect: (context, state) {
      final authState = ref.read(authStateProvider);
      final isLoading = authState.isLoading;
      final isAuthenticated = authState.asData?.value != null;
      final loc = state.matchedLocation;

      if (isLoading) {
        return loc == '/splash' ? null : '/splash';
      }

      if (!isAuthenticated) {
        return loc == '/login' ? null : '/login';
      }

      // 프로필 조회 중 → splash 대기
      final profileState = ref.read(profileAccessProvider);
      return profileAccessRedirect(
        accessState: resolvedProfileAccessState(profileState),
        location: loc,
      );
    },
    routes: [
      GoRoute(
        path: '/splash',
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/onboarding',
        builder: (context, state) => const OnboardingScreen(),
      ),
      GoRoute(
        path: '/account-disabled',
        builder: (context, state) => const _ProfileAccessGateScreen(
          isDisabled: true,
        ),
      ),
      GoRoute(
        path: '/profile-access-error',
        builder: (context, state) => const _ProfileAccessGateScreen(
          isDisabled: false,
        ),
      ),
      GoRoute(
        path: '/discovery',
        builder: (context, state) => const DiscoveryScreen(),
      ),
      GoRoute(
        path: '/lounge',
        builder: (context, state) => const LoungeScreen(),
      ),
      GoRoute(
        path: '/lounge/compose',
        builder: (context, state) => const LoungeComposeScreen(),
      ),
      GoRoute(
        path: '/lounge/post/:postId',
        builder: (context, state) {
          final postId = state.pathParameters['postId'] ?? '';
          return LoungeDetailScreen(postId: postId);
        },
      ),
      GoRoute(
        path: '/matches',
        redirect: (context, state) => legacyMainTabRedirects['/matches'],
      ),
      GoRoute(
        path: '/chats',
        builder: (context, state) => const ChatsListScreen(),
      ),
      GoRoute(
        path: '/chat/:matchId',
        builder: (context, state) {
          final matchId = state.pathParameters['matchId'] ?? '';
          return ChatScreen(matchId: matchId);
        },
      ),
      GoRoute(
        path: '/profile',
        redirect: (context, state) => legacyMainTabRedirects['/profile'],
      ),
      GoRoute(
        path: '/profile/edit',
        builder: (context, state) => const ProfileEditScreen(),
      ),
      GoRoute(
        path: '/profile/detail/:uid',
        builder: (context, state) {
          final uid = state.pathParameters['uid'] ?? '';
          return ProfileDetailScreen(uid: uid);
        },
      ),
      GoRoute(
        path: '/settings',
        builder: (context, state) => const SettingsScreen(),
      ),
      GoRoute(
        path: '/settings/blocks',
        builder: (context, state) => const BlockedUsersScreen(),
      ),
      GoRoute(
        path: '/paywall',
        builder: (context, state) => const PaywallScreen(),
      ),
      GoRoute(
        path: '/',
        redirect: (context, state) => '/discovery',
      ),
    ],
    errorBuilder: (context, state) => Scaffold(
      appBar: AppBar(title: const Text('Error')),
      body: Center(child: Text('Route not found: ${state.uri}')),
    ),
  );

  ref.onDispose(() {
    router.dispose();
    notifier.dispose();
  });

  return router;
});

class _ProfileAccessGateScreen extends ConsumerWidget {
  const _ProfileAccessGateScreen({required this.isDisabled});

  final bool isDisabled;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Hana')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                isDisabled ? Icons.block_outlined : Icons.cloud_off_outlined,
                size: 48,
              ),
              const SizedBox(height: 16),
              Text(
                isDisabled ? '현재 사용할 수 없는 계정입니다.' : '계정 상태를 확인하지 못했어요.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 20),
              if (isDisabled)
                FilledButton(
                  onPressed: () => ref.read(authRepositoryProvider).signOut(),
                  child: const Text('로그아웃'),
                )
              else
                FilledButton(
                  onPressed: () => ref.invalidate(profileAccessProvider),
                  child: const Text('다시 시도'),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
