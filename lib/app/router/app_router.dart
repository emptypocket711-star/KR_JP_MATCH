import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/onboarding/presentation/onboarding_screen.dart';
import '../../features/discovery/presentation/discovery_screen.dart';
import '../../features/matches/presentation/matches_screen.dart';
import '../../features/matches/presentation/chats_list_screen.dart';
import '../../features/chat/presentation/chat_screen.dart';
import '../../features/profile/presentation/profile_screen.dart';
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

class _AuthChangeNotifier extends ChangeNotifier {
  _AuthChangeNotifier(Ref ref) {
    ref.listen(authStateProvider, (_, __) => notifyListeners());
    ref.listen(profileExistsProvider, (_, __) => notifyListeners());
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
      final profileState = ref.read(profileExistsProvider);
      if (profileState.isLoading) {
        return loc == '/splash' ? null : '/splash';
      }

      // 프로필 미완성 유저 → 온보딩
      final profileExists = profileState.asData?.value ?? false;
      if (!profileExists) {
        return loc == '/onboarding' ? null : '/onboarding';
      }

      // 인증됨 — 인증 전용 화면에서 벗어남
      if (loc == '/splash' ||
          loc == '/login' ||
          loc == '/onboarding' ||
          loc == '/') {
        return '/discovery';
      }

      return null;
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
        builder: (context, state) => const MatchesScreen(),
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
        builder: (context, state) => const ProfileScreen(),
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
