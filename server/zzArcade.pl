# zzArcade.pl - Mortal Arcade additions for OpenMortal 0.7. The game loads it like any other
# file in data/characters; none of the original game files are changed.
#
# 1. A computer opponent for Player 2. OpenMortal 0.7 has no single player mode (the menu item
#    is greyed out), so this plays Player 2 through the same input object a person uses: each
#    time Player 2's fighter is ready for a new move, it picks one from that fighter's own move
#    table (walk, block, punches, kicks, specials). It only plays when the big screen says
#    Player 2's seat is empty, never in the attract-mode demos, and it steps aside as soon as
#    someone presses a Player 2 button.
# 2. Two small text files that let the big screen follow the game:
#    ../arcade/state.txt    written here: which screen the game is on
#    ../arcade/control.txt  written by the big screen: who sits in Player 2's seat
# 3. A fix for the game's own crash on a 5-hit combo (see the end of this file).

$| = 1;

package ArcadeAI;
@ArcadeAI::ISA = ('PlayerInput');

$Dir = '../arcade';
%Cfg = ( p2 => 'human', level => 'normal', seq => 0 );
# block: % of attacks blocked; attack: % of chances taken when close; idle: % of decisions
# spent waiting; special: % of chances to use a special from afar; combo: % of attacks that
# are the fighter's special inputs instead of a plain punch or kick
%Level = (
	easy   => { block => 20, attack => 45, idle => 35, special => 6,  combo => 10, jump => 4 },
	normal => { block => 50, attack => 65, idle => 16, special => 14, combo => 28, jump => 7 },
	hard   => { block => 78, attack => 85, idle => 5,  special => 22, combo => 45, jump => 9 },
);
$Armed = 0; $AfterJudgement = 0; @Picked = (0, 0); $Phase = 'menu'; $Winner = -1; $Round = 0;
$HumanP2 = 0; $Seq = 0; $NextRead = 0;

sub ReadFile {
	my ($name) = @_;
	local *ARCADEIN;
	open( ARCADEIN, "<$Dir/$name" ) or return undef;
	local $/; my $text = <ARCADEIN>;
	close ARCADEIN;
	return $text;
}

sub ParseCfg {
	my ($text) = @_;
	return unless defined $text;
	while ( $text =~ /(\w+)\s*=\s*([\w.-]+)/g ) { $Cfg{$1} = $2; }
}

# control.txt is created here (from defaults.txt in the injected files) so that it is a normal
# file the big screen can overwrite while the game runs
sub Init {
	mkdir $Dir, 0755 unless -d $Dir;
	ParseCfg( ReadFile('defaults.txt') );
	ParseCfg( ReadFile('control.txt') );
	local *ARCADEOUT;
	if ( open( ARCADEOUT, ">$Dir/control.txt" ) ) {
		print ARCADEOUT "p2=$Cfg{p2} level=$Cfg{level} seq=$Cfg{seq}\n";
		close ARCADEOUT;
	}
	WriteState();
}

sub PollControl {
	ParseCfg( ReadFile('control.txt') );
}

sub WriteState {
	local *ARCADEOUT;
	return unless open( ARCADEOUT, ">$Dir/state.txt" );
	print ARCADEOUT "phase=$Phase p1picked=$Picked[0] p2picked=$Picked[1] winner=$Winner round=$Round cpu=",
		( $Cfg{p2} eq 'cpu' ? 1 : 0 ), " humanp2=$HumanP2 tick=", ( $::gametick || 0 ), " seq=", ++$Seq, "\n";
	close ARCADEOUT;
}

sub Active {
	return 0 unless $Armed and $Cfg{p2} eq 'cpu' and $::NUMPLAYERS == 2;
	return 0 if $::over;
	return 0 if $HumanP2;      # someone pressed a Player 2 button during this game: they play
	return 1;
}

# --- the opponent ----------------------------------------------------------------------------

# a deterministic "random" number in 0..n-1, different for each salt
sub R {
	my ($n, $salt) = @_;
	my ($me, $op) = @::Fighters[1, 0];
	my $s = ( ($::gametick % 100003) * 7919 + (int($me->{HP}) % 1000) * 104729
		+ (int($op->{X} / 8) % 10007) * 31 + (int($me->{X} / 8) % 10007) * 131
		+ $salt * 1009 + ($Seq % 997) * 17 ) % 1000003;
	return $s % $n;
}

sub Base { my ($st) = @_; $st =~ s/\s*\d+$//; return $st; }

# is there a frame that hits still ahead in this fighter's current move?
sub HitAhead {
	my ($f) = @_;
	my $name = $f->{ST};
	my $base = Base( $name );
	for ( my $i = 0; $i < 30 and defined $name; ++$i ) {
		my $st = $f->{STATES}->{$name} or return 0;
		return 1 if $st->{HIT};
		$name = $st->{NEXTST};
		return 0 unless defined $name and Base( $name ) eq $base;
	}
	return 0;
}

sub Attacking {
	my ($f) = @_;
	my $base = Base( $f->{ST} );
	return 0 if $base =~ /ed$|^(Falling|Laying|Getup|Dead|Won|Hurt|Stand|Walk|Back|Block|Turn|Kneeling|Onknees|Fun|Threat|Start|Jump)/;
	return $base =~ /Punch|Kick|Uppercut|Sweep|Elbow|Spin|Throw|Spec|Head|Grab|Grenade|Special/ ? 1 : 0;
}

# the opponent is about to land a hit
sub Threatened {
	my ($op, $dist) = @_;
	return Attacking($op) && HitAhead($op) && abs($dist) < 1700;
}

# the opponent has swung and is recovering: a chance to hit back
sub Recovering {
	my ($op, $dist) = @_;
	return Attacking($op) && !HitAhead($op) && abs($dist) < 1200;
}

# a projectile from the other player is on its way
sub IncomingShot {
	my ($me) = @_;
	foreach my $d (@::Doodads) {
		next unless $d->{HOSTILE} and defined $d->{OWNER} and $d->{OWNER} != 1;
		my $dx = $me->{X} - $d->{POS}->[0];
		next unless $d->{SPEED}->[0] * $dx > 0;          # moving towards me
		return 1 if abs($dx) < 2600;
	}
	return 0;
}

# split a move-table key like 'lpunchBD' into the (action, modifiers) pair GetAction returns
sub Split {
	my ($key) = @_;
	return ($1, $2) if $key =~ /^(lpunch|hpunch|lkick|hkick)([UDBFX]*)$/;
	return ($key, '');
}

sub Decide {
	my ($me, $op, $con) = @_;
	my $P = $Level{ $Cfg{level} } || $Level{normal};
	my $dist = ($op->{X} - $me->{X}) * $me->{DIR};     # > 0: the opponent is in front of me
	my $opbase = Base( $op->{ST} );
	my $mybase = Base( $me->{ST} );
	my (@specials, @combos, @basic);

	foreach my $key (keys %{$con}) {
		next unless $key =~ /^(lpunch|hpunch|lkick|hkick)/;
		my $target = Base( $con->{$key} );
		if ( $target =~ /Grenade|Special|Shot|Fire/ ) { push @specials, $key; }
		elsif ( $key =~ /^(lpunch|hpunch|lkick|hkick)$/ ) { push @basic, $key; }
		else { push @combos, $key; }
	}
	@specials = sort @specials; @combos = sort @combos; @basic = sort @basic;

	# defend: keep a block up while the hit is coming, block new attacks, jump over shots
	my $threat = Threatened( $op, $dist );
	if ( $con->{block} and $threat and $mybase eq 'Block' and R(100, 18) < $P->{block} + 35 ) { return ('block'); }
	if ( $con->{block} and ( $threat or IncomingShot($me) ) and R(100, 1) < $P->{block} ) { return ('block'); }
	if ( IncomingShot($me) and $con->{jumpfw} and R(100, 2) < $P->{jump} * 3 ) { return ('jumpfw'); }

	# hit back while the opponent recovers from a swing
	if ( Recovering( $op, $dist ) and @basic and R(100, 19) < $P->{attack} ) {
		my @close = grep { !/^lpunchBD$/ } @combos;
		return Split( $close[ R(scalar @close, 20) ] ) if @close and R(100, 21) < $P->{combo};
		return Split( $basic[ R(scalar @basic, 22) ] );
	}

	# in the air: kick when close
	if ( $mybase =~ /^Jump/ ) {
		return Split( $con->{hkick} ? 'hkick' : 'lkick' ) if abs($dist) < 1400 and ($con->{hkick} or $con->{lkick});
		return ('');
	}

	# the opponent is down: walk up, sometimes wait
	if ( $opbase =~ /^(Falling|Laying|Getup|Dead)/ ) {
		return ('forw') if $con->{forw} and $dist > 1100 and R(100, 3) < 60;
		return ('');
	}

	return ('') if R(100, 4) < $P->{idle};

	# far away: close in, or throw a special
	if ( $dist > 1500 ) {
		return Split( $specials[ R(scalar @specials, 5) ] ) if @specials and R(100, 6) < $P->{special};
		return ('jumpfw') if $con->{jumpfw} and R(100, 7) < $P->{jump};
		return ('forw') if $con->{forw};
		return ('');
	}

	# middle distance: long kicks, a jump in, or step closer
	if ( $dist > 950 ) {
		if ( R(100, 8) < $P->{attack} / 2 ) {
			my @k = grep { /kick/ } @basic;
			return Split( $k[ R(scalar @k, 9) ] ) if @k;
		}
		return ('jumpfw') if $con->{jumpfw} and R(100, 10) < $P->{jump};
		return ('forw') if $con->{forw};
		return ('');
	}

	# close: attack, step back now and then, crouch now and then
	if ( R(100, 11) < $P->{attack} ) {
		my @close = grep { !/^lpunchBD$/ } @combos;
		return Split( $close[ R(scalar @close, 12) ] ) if @close and R(100, 13) < $P->{combo};
		return Split( $basic[ R(scalar @basic, 14) ] ) if @basic;
	}
	return ('down') if $con->{down} and R(100, 15) < 10;
	return ('back') if $con->{back} and R(100, 16) < 12;
	return ('block') if $con->{block} and R(100, 17) < 10;
	return ('');
}

sub GetAction {
	my ($self) = @_;
	return $self->SUPER::GetAction() unless Active();
	my ($me, $op) = @::Fighters[1, 0];
	return ('') unless $me->{OK} and $op->{OK};
	my $con = $me->{STATES}->{ $me->{ST} }->{CON} || {};
	$Seq++;
	my @r = Decide( $me, $op, $con );
	print "ArcadeAI: $me->{ST} vs $op->{ST} -> @r\n" if $Cfg{debug};
	return @r;
}

sub ActionAccepted {
	my ($self) = @_;
	return if Active();
	return $self->SUPER::ActionAccepted();
}

package main;

# --- hooks into the game's own entry points (the executable calls these by name) -------------

sub ArcadeWrap {
	my ($name, $before) = @_;
	my $orig = \&{"main::$name"};
	*{"main::$name"} = sub { $before->(@_); return $orig->(@_); };
}

ArcadeWrap( 'SelectStart', sub {
	# the winner's story screen right after a match calls this too, before the next select
	$ArcadeAI::Phase = $ArcadeAI::AfterJudgement ? 'story' : 'select';
	$ArcadeAI::AfterJudgement = 0; @ArcadeAI::Picked = (0, 0); $ArcadeAI::Armed = 0; $ArcadeAI::Winner = -1; $ArcadeAI::Round = 0;
	$ArcadeAI::HumanP2 = 0;
	ArcadeAI::PollControl(); ArcadeAI::WriteState();
} );
ArcadeWrap( 'PlayerSelected', sub {
	my ($n) = @_;
	$ArcadeAI::Picked[$n] = 1 if $n == 0 or $n == 1;
	$ArcadeAI::Armed = 1 if $ArcadeAI::Picked[0] and $ArcadeAI::Picked[1];
	ArcadeAI::WriteState();
} );
ArcadeWrap( 'GameStart', sub {
	# demos replay recorded games without anyone picking fighters first: no computer player there
	$ArcadeAI::Phase = $ArcadeAI::Armed ? 'fight' : 'demo';
	$ArcadeAI::Round++ if $ArcadeAI::Armed;
	ArcadeAI::PollControl(); ArcadeAI::WriteState();
} );
ArcadeWrap( 'JudgementStart', sub {
	($ArcadeAI::Winner) = @_;
	$ArcadeAI::Phase = 'judgement'; $ArcadeAI::Armed = 0; $ArcadeAI::AfterJudgement = 1;
	ArcadeAI::WriteState();
} );
ArcadeWrap( 'KeyDown', sub {
	my ($player) = @_;
	if ( $player == 1 and $ArcadeAI::Phase eq 'fight' and !$ArcadeAI::HumanP2 ) {
		$ArcadeAI::HumanP2 = 1;
		ArcadeAI::WriteState();
	}
} );
ArcadeWrap( 'GameAdvance', sub {
	bless $::Inputs[1], 'ArcadeAI' if defined $::Inputs[1] and ref( $::Inputs[1] ) ne 'ArcadeAI';
	if ( $::gametick >= $ArcadeAI::NextRead or $::gametick < $ArcadeAI::NextRead - 100 ) {
		$ArcadeAI::NextRead = $::gametick + 40;
		ArcadeAI::PollControl();
		# about once a second during a fight, so the big screen can show whether the game
		# keeps its full speed (ticks per second against the game speed setting)
		ArcadeAI::WriteState() if $ArcadeAI::Phase eq 'fight' and $::gametick % 80 < 40;
	}
} );

# --- 3. a fix for a bug in the game itself ----------------------------------------------------
# OpenMortal 0.7's Fighter.pl ends a 5-hit combo with $other->HitEvent( 'Fall', 'Maxcombo' ),
# leaving out who did the hitting. HitEvent then dies with "Unknown event: Maxcombo" and the
# game quits in the middle of the fight. The computer player lands 5-hit combos far more often
# than people do, so this fills in the missing fighter; the rest of HitEvent runs unchanged.
{
	my $orig = \&Fighter::HitEvent;
	local $^W = 0;
	*Fighter::HitEvent = sub ($$$$) {
		my ( $self, $other, $event ) = @_;
		if ( !ref( $other ) and defined $event and $event eq 'Maxcombo' ) {
			my $opponent = $self->{OTHER};
			$opponent = ( grep { ref( $_ ) and $_ != $self } @::Fighters )[0] unless ref( $opponent ) and $opponent != $self;
			return $orig->( $self, $opponent, $other, $event ) if ref( $opponent );
			return;
		}
		return $orig->( @_ );
	};
}

# A Perl error inside one game tick makes the executable stop the game. Should another one turn
# up, report it once in stderr.txt and carry on with the next tick instead.
{
	my $orig = \&main::GameAdvance;
	my %reported;
	local $^W = 0;
	*main::GameAdvance = sub {
		my @r = eval { $orig->( @_ ) };
		print STDERR "Mortal Arcade kept the game going after: $@" if $@ and !$reported{$@}++;
		return wantarray ? @r : $r[0];
	};
}

ArcadeAI::Init();

return 1;
